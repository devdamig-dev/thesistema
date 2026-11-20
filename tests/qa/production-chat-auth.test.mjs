import test from 'node:test';
import assert from 'node:assert/strict';

test('GastroPilot chat en producción rechaza anónimos desde Auth, sin modo demo',async()=>{
  const response=await fetch('https://gastropilot.nexodg.com/api/chat',{
    method:'GET',redirect:'manual',headers:{Accept:'application/json'},
    signal:AbortSignal.timeout(15000),
  });
  const type=(response.headers.get('content-type')||'').toLowerCase();
  assert.ok(type.includes('application/json'),'Debe responder la API de la aplicación y no SSO/HTML');
  const body=await response.json();
  assert.equal(response.status,401,'Esperado 401. Si devuelve 409/demo_mode, verificar NEXT_PUBLIC_APP_MODE en producción; si 200, revisar seguridad.');
  assert.equal(body.code,'unauthenticated','La API debe rechazar una sesión anónima real');
  console.log('PASS: /api/chat en modo database bloqueó usuario anónimo con HTTP 401');
});
