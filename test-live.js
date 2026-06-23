// test

async function main() {
  try {
    const loginRes = await fetch('https://erp-backend-3rgo.onrender.com/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'master@dev.com', password: 'admin' })
    });
    const auth = await loginRes.json();
    console.log('Login:', auth.token ? 'Success' : auth);

    const catRes = await fetch('https://erp-backend-3rgo.onrender.com/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
      body: JSON.stringify({ name: 'teste remoto', type: 'outcome' })
    });
    
    const catData = await catRes.json();
    console.log('Category response:', catRes.status, catData);
  } catch (err) {
    console.error(err);
  }
}
main();
