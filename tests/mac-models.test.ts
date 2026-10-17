import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const script=resolve('scripts/mac-whisper-models.sh');
test('Mac deployment helper parses in bash, documents explicit install/run commands',()=>{
  const syntax=spawnSync('bash',['-n',script],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  const help=spawnSync('bash',[script,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0,help.stderr);
  for(const fragment of ['bootstrap','download small|medium|large|all',
    'engine small|medium|large','run small|medium|large','large-v3',
    'not', 'config.json']){
    assert.match(help.stdout,new RegExp(fragment.replace(/[|.]/g,x=>'\\'+x),'i'));
  }
});
test('Mac helper invalid subcommand does not download or run anything',()=>{
  const invalid=spawnSync('bash',[script,'definitely-invalid'],{encoding:'utf8'});
  assert.notEqual(invalid.status,0);
  assert.match(invalid.stderr,/Unknown command/);
});
