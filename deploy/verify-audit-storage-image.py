#!/usr/bin/python3
"""Disposable root-owned /run fixture; actual app image, synthetic command bridge.
No host networking, published ports, real identities, or production paths.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parent-image-evidence', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    assert os.geteuid() == 0
    evidence = args.evidence
    evidence.mkdir(parents=True, exist_ok=False)
    manifest = json.loads((args.parent_image_evidence / 'app-source-sha256.json').read_text())
    assert all(hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == h for p, h in manifest.items()), 'rebuild required: input drift'
    image = json.loads((args.parent_image_evidence / 'SUCCESS.json').read_text())['images']['app']['image_id']
    source_hash = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    owned = []
    records = []
    temp = Path(tempfile.mkdtemp(prefix='jc-audit-container-', dir='/run'))
    prefix = 'jc-audit-' + secrets.token_hex(6)
    def run(argv, check=True):
        p = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
        if check and p.returncode: raise RuntimeError(p.stdout)
        return p
    def docker(*argv, check=True): return run(['docker', *argv], check=check)
    def state(name): return json.loads(docker('inspect', name).stdout)[0]
    def cleanup():
        for name in reversed(owned):
            docker('rm', '-f', name, check=False)
            assert not docker('ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}').stdout.strip()
        shutil.rmtree(temp)
        assert not temp.exists()
        (evidence / 'cleanup.json').write_text(json.dumps({'containers': owned, 'fixture': str(temp), 'removed': True, 'created_networks': []}, indent=2))
    try:
        inspection = json.loads(docker('image', 'inspect', image).stdout)[0]
        assert inspection['Id'] == image and inspection['Config']['User'] == '10001:10001'
        assert inspection['Config']['Labels']['org.jarvis-command.source-sha256'] == source_hash
        spec = importlib.util.spec_from_file_location('storage', ROOT / 'deploy/prepare-audit-storage.py')
        assert spec and spec.loader
        helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
        ledger = temp / 'audit/events.jsonl'
        initial = helper.storage(temp, ledger, prepare=True)
        # Ephemeral JWT generation uses crypto only; never logs private key or assertion.
        fixture = temp / 'fixture'; fixture.mkdir()
        script = r"""
const fs=require('node:fs'),c=require('node:crypto');
const {privateKey,publicKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});
const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const body=enc({alg:'RS256',kid:'fixture'})+'.'+enc({iss:'https://fixture.cloudflareaccess.com',aud:'a'.repeat(64),sub:'fixture-operator',email:'operator@example.test',type:'app',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600});
fs.writeFileSync(process.argv[1]+'/jwt',body+'.'+c.sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url'),{mode:0o444});
fs.writeFileSync(process.argv[1]+'/jwks.json',JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),alg:'RS256',kid:'fixture',use:'sig'}]}),{mode:0o444});
"""
        run(['/home/neal/.local/bin/node', '-e', script, str(fixture)])
        upstream = r"""
const http=require('node:http');let mutations=0;const runId='run_'+'b'.repeat(32),sessionId='jc_'+'a'.repeat(32);
http.createServer((req,res)=>{res.setHeader('content-type','application/json');
if(req.url==='/counts')return res.end(JSON.stringify({mutations}));
if(req.headers.authorization!=='Bearer '+ 'synthetic-command-'.repeat(3)){res.statusCode=401;return res.end('{}');}
if(req.url==='/_ready')return res.end(JSON.stringify({ready:true,durableIdempotency:true,retentionSeconds:86400,externalContinue:false}));
if(req.url==='/v1/runs'&&req.method==='POST'){mutations++;req.resume();return res.end(JSON.stringify({runId,sessionId,status:'running',replayed:false}));}
if(req.url==='/v1/runs/'+runId)return res.end(JSON.stringify({runId,sessionId,status:'running',updatedAt:new Date().toISOString(),approval:null,output:null,error:null,pendingSteer:null,usage:null}));
res.statusCode=404;res.end('{}');}).listen(18643,'127.0.0.1');
"""
        common = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '192m', '--memory-swap', '192m', '--cpus', '0.5', '--pids-limit', '64']
        fixture_name = prefix + '-fixture'; owned.append(fixture_name)
        docker('run', '-d', '--name', fixture_name, '--network', 'none', *common, '--mount', f'type=bind,src={fixture},dst=/fixture,readonly', '--entrypoint', 'node', image, '-e', upstream)
        env = {'AUTH_MODE':'cloudflare','COMMAND_MODE':'enabled','CF_ACCESS_TEAM_DOMAIN':'fixture.cloudflareaccess.com','CF_ACCESS_AUD':'a'*64,'CF_ACCESS_EMAIL_SHA256':hashlib.sha256(b'operator@example.test').hexdigest(),'CF_ACCESS_JWKS_FILE':'/run/fixture-jwks.json','HERMES_READ_PROXY_KEY':'synthetic-read-'*3,'HERMES_API_BASE_URL':'http://127.0.0.1:18642','PUBLIC_ORIGIN':'https://command.example.test','HERMES_COMMAND_API_BASE_URL':'http://127.0.0.1:18643','HERMES_COMMAND_PROXY_KEY':'synthetic-command-'*3,'COMMAND_AUDIT_LOG_PATH':'/var/lib/jarvis-command/audit/events.jsonl','PORT':'3000'}
        def launch(suffix, source, ready=True):
            name=prefix+'-'+suffix; owned.append(name)
            argv=['run','-d','--name',name,'--network','container:'+fixture_name,*common,'--mount',f'type=bind,src={fixture / "jwks.json"},dst=/run/fixture-jwks.json,readonly']
            if source is not None: argv += ['--mount',f'type=bind,src={source},dst=/var/lib/jarvis-command/audit']
            for k,v in env.items(): argv += ['-e',k+'='+v]
            result=docker(*argv,image,check=ready)
            if not ready: return name,result
            deadline=time.monotonic()+15
            while True:
                probe=docker('exec',fixture_name,'node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))",check=False)
                if probe.returncode==0: break
                assert state(name)['State']['Running'] and time.monotonic()<deadline
                time.sleep(.1)
            s=state(name); h=s['HostConfig']
            assert s['Image']==image and s['Config']['User']=='10001:10001' and h['ReadonlyRootfs'] and h['CapDrop']==['ALL']
            assert h['NetworkMode']=='container:'+state(fixture_name)['Id'] and not h['PortBindings']
            assert h['SecurityOpt']==['no-new-privileges:true'] and h['Memory']==h['MemorySwap']==192*1024*1024 and h['PidsLimit']==64 and h['NanoCpus']==500000000
            assert sorted((m['Source'],m['Destination'],m['RW']) for m in s['Mounts']) == sorted([(str(fixture/'jwks.json'),'/run/fixture-jwks.json',False),(str(source),'/var/lib/jarvis-command/audit',True)])
            records.append({'container':name,'id':s['Id'],'image':s['Image'],'mounts':s['Mounts'],'host_config':h})
            return name,result
        def request(expected, authenticated=True):
            code=r"""
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const r=await fetch('http://127.0.0.1:3000/api/live/runs',{method:'POST',headers:{'content-type':'application/json',origin:'https://command.example.test','x-jarvis-command':'1',AUTH},body:JSON.stringify({sessionId:'jc_'+'a'.repeat(32),clientRequestId:'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e',input:'Synthetic storage test'}),signal:AbortSignal.timeout(4000)});const body=await r.json();assert.equal(r.status,EXPECTED,JSON.stringify(body));console.log(JSON.stringify(body));})().catch(e=>{console.error(e);process.exit(1)});
""".replace('AUTH',"'cf-access-jwt-assertion':fs.readFileSync('/fixture/jwt','utf8')" if authenticated else "'x-no-auth':'1'").replace('EXPECTED',str(expected))
            return json.loads(docker('exec',fixture_name,'node','-e',code).stdout)
        def count():
            return json.loads(docker('exec',fixture_name,'node','-e',"fetch('http://127.0.0.1:18643/counts').then(r=>r.text()).then(console.log)").stdout)['mutations']
        first,_=launch('first',ledger.parent)
        request(401,False); assert count()==0
        admitted=request(200); assert count()==1 and not admitted['replayed']
        persisted=ledger.read_bytes(); assert b'run.started' in persisted and b'Synthetic storage test' not in persisted
        docker('stop','-t','5',first); docker('rm',first)
        second,_=launch('replacement',ledger.parent)
        replay=request(200); assert replay['publicRunId']==admitted['publicRunId'] and replay['replayed'] and count()==1
        docker('restart','-t','5',second)
        deadline=time.monotonic()+10
        while docker('exec',fixture_name,'node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))",check=False).returncode:
            assert time.monotonic()<deadline; time.sleep(.1)
        assert request(200)['publicRunId']==admitted['publicRunId'] and count()==1
        assert ledger.stat().st_ino==initial['inode']
        ledger.chmod(0o644); request(503); assert count()==1
        docker('stop','-t','5',second)
        # Deliberate fixture-only damage, not helper repair or operator recovery.
        ledger.chmod(0o600); ledger.write_bytes(b'corrupt\n')
        corrupt,_=launch('corrupt',ledger.parent,False)
        deadline=time.monotonic()+10
        while state(corrupt)['State']['Running']:
            assert time.monotonic()<deadline; time.sleep(.1)
        assert state(corrupt)['State']['ExitCode']!=0 and count()==1
        missing,result=launch('missing',temp/'absent',False)
        assert result.returncode!=0 and 'bind source path does not exist' in result.stdout and not (temp/'absent').exists()
        absent,_=launch('no-bind',None,False)
        deadline=time.monotonic()+10
        while state(absent)['State']['Running']:
            assert time.monotonic()<deadline; time.sleep(.1)
        assert state(absent)['State']['ExitCode']!=0 and count()==1
        assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in manifest.items())
        result={'passed':True,'image':image,'source_hash':source_hash,'input_hashes':manifest,'initial_storage':initial,'authenticated_admission':admitted,'replacement_replay':replay,'upstream_mutations':count(),'permission_denial':503,'corrupt_startup_denied':True,'missing_source_denied_without_creation':True,'no_bind_startup_denied':True,'same_inode_after_replacement_and_restart':True,'containers':records,'scope':'actual emitted app and JWT; synthetic command bridge (not actual proxies/Hermes/browser)'}
        (evidence/'storage-result.json').write_text(json.dumps(result,indent=2)+'\n')
    finally:
        cleanup()
    print('PASS actual authenticated app image storage replacement/restart and denial; cleanup verified')


if __name__ == '__main__': main()
