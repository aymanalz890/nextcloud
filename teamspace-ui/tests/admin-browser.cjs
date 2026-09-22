// Run against a fresh localhost test fixture. Never use this against live accounts.
const {chromium}=require('playwright');
const {mkdirSync}=require('node:fs');
(async()=>{
 mkdirSync('test-artifacts',{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}: {})});
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('http://localhost:8081');
 async function login(user){await page.getByLabel('Username',{exact:true}).fill(user);await page.getByLabel('Password or app password',{exact:true}).fill('test-app-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();}
 await login('ncadmin');await page.getByRole('button',{name:'Users & Groups',exact:true}).click();
 await page.getByRole('button',{name:'Create group',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel('Group name',{exact:true}).fill('Project-Team');await dialog.getByRole('button',{name:'Create group',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Users',exact:true}).click();await page.getByRole('button',{name:'Create user',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('Username',{exact:true}).fill('new.member');await dialog.getByLabel('Display name',{exact:true}).fill('New Teammate');await dialog.getByLabel('Initial password',{exact:true}).fill('Strong-initial-password-2026');await dialog.getByRole('button',{name:'Create user',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.getByText('New Teammate',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Groups',exact:true}).click();await page.getByLabel('Find a user to add',{exact:true}).fill('new.member');await page.getByRole('button',{name:'Find user',exact:true}).click();await page.getByRole('button',{name:'Add new.member to Project-Team',exact:true}).click();await page.getByRole('button',{name:'Remove new.member from Project-Team',exact:true}).waitFor();
 await page.screenshot({path:'test-artifacts/admin-groups.png'});
 await page.getByRole('button',{name:'Remove new.member from Project-Team',exact:true}).click();await page.getByText('No members yet',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Users',exact:true}).click();const row=page.getByRole('row').filter({hasText:'new.member'});await row.getByRole('button',{name:'Disable',exact:true}).click();await row.getByRole('button',{name:'Enable',exact:true}).waitFor();await row.getByRole('button',{name:'Enable',exact:true}).click();await row.getByRole('button',{name:'Disable',exact:true}).waitFor();
 await page.screenshot({path:'test-artifacts/admin-users.png'});
 await page.getByRole('button',{name:'Groups',exact:true}).click();await page.getByRole('button',{name:'Create group',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('Group name',{exact:true}).fill('Project-Team');await dialog.getByRole('button',{name:'Create group',exact:true}).click();await dialog.getByRole('alert').waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-artifacts/admin-mobile.png'});if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw new Error('Mobile page overflow');
 await page.setViewportSize({width:1440,height:1050});await page.getByRole('button',{name:'Sign out',exact:true}).click();await login('meshal');if(await page.getByRole('button',{name:'Users & Groups',exact:true}).count())throw new Error('Non-admin sees admin controls');const status=await page.evaluate(async()=> (await fetch('/api/admin/groups')).status);if(status!==403)throw new Error('Non-admin API access was not rejected');
 if(errors.length)throw new Error(errors.join('\n'));console.log('PASS: admin UI lifecycle, duplicate feedback, mobile layout, and non-admin denial; no page errors.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
