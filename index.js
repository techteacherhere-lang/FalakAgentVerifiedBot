require('dotenv').config();
const express=require('express'),cookieParser=require('cookie-parser'),jwt=require('jsonwebtoken');
const {Pool}=require('pg'); const {Telegraf,Markup}=require('telegraf');
for(const k of ['BOT_TOKEN','DATABASE_URL','JWT_SECRET','WEBHOOK_SECRET','BASE_URL','ADMIN_USERNAME','ADMIN_PASSWORD']) if(!process.env[k]) throw Error('Missing '+k);
const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); const q=(s,p=[])=>db.query(s,p);
const SQL=`CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,telegram_id BIGINT UNIQUE NOT NULL,username TEXT,first_name TEXT,referred_by BIGINT,balance NUMERIC(12,2) DEFAULT 0,lifetime_earned NUMERIC(12,2) DEFAULT 0,lifetime_withdrawn NUMERIC(12,2) DEFAULT 0,status TEXT DEFAULT 'active',created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS channels(id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,chat_id TEXT UNIQUE NOT NULL,username TEXT,invite_url TEXT,required BOOLEAN DEFAULT TRUE,active BOOLEAN DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS tasks(id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,description TEXT,reward NUMERIC(12,2) DEFAULT 0,daily_limit INT DEFAULT 1,active BOOLEAN DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS attempts(id BIGSERIAL PRIMARY KEY,task_id BIGINT REFERENCES tasks(id),user_id BIGINT REFERENCES users(id),status TEXT DEFAULT 'started',created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS transactions(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id),type TEXT,amount NUMERIC(12,2),status TEXT DEFAULT 'confirmed',reference TEXT,note TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS referrals(id BIGSERIAL PRIMARY KEY,referrer_id BIGINT REFERENCES users(id),referred_id BIGINT UNIQUE REFERENCES users(id),status TEXT DEFAULT 'pending',reward NUMERIC(12,2) DEFAULT 0);
CREATE TABLE IF NOT EXISTS withdrawals(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id),amount NUMERIC(12,2),method TEXT,destination TEXT,status TEXT DEFAULT 'pending',note TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS gift_codes(id BIGSERIAL PRIMARY KEY,code TEXT UNIQUE,amount NUMERIC(12,2),max_uses INT DEFAULT 1,used_count INT DEFAULT 0,active BOOLEAN DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS gift_uses(id BIGSERIAL PRIMARY KEY,gift_id BIGINT REFERENCES gift_codes(id),user_id BIGINT REFERENCES users(id),UNIQUE(gift_id,user_id));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES('min_withdrawal','100'),('referral_reward','10'),('currency','₹') ON CONFLICT(key) DO NOTHING;`;
const bot=new Telegraf(process.env.BOT_TOKEN); async function setting(k,d=''){const r=await q('SELECT value FROM settings WHERE key=$1',[k]);return r.rows[0]?.value??d}
async function getUser(t){return (await q('SELECT * FROM users WHERE telegram_id=$1',[t])).rows[0]}
async function upsert(t,p){let u=await getUser(t.id);if(u)return u;let ref=null;if(p?.startsWith('ref_')){let r=await q('SELECT id FROM users WHERE telegram_id=$1',[Number(p.slice(4))]);ref=r.rows[0]?.id||null}let r=await q('INSERT INTO users(telegram_id,username,first_name,referred_by) VALUES($1,$2,$3,$4) RETURNING *',[t.id,t.username||null,t.first_name||'',ref]);if(ref)await q('INSERT INTO referrals(referrer_id,referred_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[ref,r.rows[0].id]);return r.rows[0]}
async function channels(){return (await q('SELECT * FROM channels WHERE active AND required ORDER BY id')).rows}
async function verified(ctx){for(const c of await channels()){try{let m=await ctx.telegram.getChatMember(c.chat_id,ctx.from.id);if(!(['creator','administrator','member'].includes(m.status)||(m.status==='restricted'&&m.is_member)))return false}catch{return false}}return true}
function menu(){return Markup.keyboard([
  ['🎁 Earn','💰 Wallet'],
  ['👥 Invite','👤 Account'],
  ['🎟 Gift Code','📜 History'],
  ['🆘 Support']
]).resize().persistent()}
async function gate(ctx){if(await verified(ctx))return true;let cs=await channels(),rows=cs.map(c=>[Markup.button.url('📢 '+c.title,c.invite_url||`https://t.me/${String(c.username||'').replace('@','')}`)]);rows.push([Markup.button.callback('✅ Verify','verify')]);await ctx.reply('🔒 Join all required channels first.',Markup.inlineKeyboard(rows));return false}
async function home(ctx){
  let u=await getUser(ctx.from.id),c=await setting('currency','₹');
  return ctx.reply(
    `🏠 <b>FALAK AGENT VERIFIED</b>\n━━━━━━━━━━━━━━━━━━\n\n💰 <b>AVAILABLE BALANCE</b>\n<code>${c}${Number(u.balance).toFixed(2)}</code>\n\n🎁 <b>TOTAL EARNED</b>\n<code>${c}${Number(u.lifetime_earned).toFixed(2)}</code>\n\n━━━━━━━━━━━━━━━━━━\n⚡ <i>Choose an option below to continue.</i>`,
    {parse_mode:'HTML',...menu()}
  );
}
bot.start(async c=>{await upsert(c.from,c.startPayload);if(!(await verified(c))){let cs=await channels(),rows=cs.map(x=>[Markup.button.url('📢 '+x.title,x.invite_url||`https://t.me/${String(x.username||'').replace('@','')}`)]);rows.push([Markup.button.callback('✅ Verify','verify')]);return c.reply('👋 Welcome!\n\n🎁 Complete tasks and earn rewards.\n👥 Invite friends.\n💸 Withdraw eligible earnings.\n\n🔒 Join required channels.',Markup.inlineKeyboard(rows))}home(c)});
bot.action('verify',async c=>{await c.answerCbQuery();if(await gate(c))home(c)});

function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

bot.hears('🎁 Earn',async c=>{
  if(!(await gate(c)))return;
  let ts=(await q('SELECT * FROM tasks WHERE active ORDER BY id DESC')).rows;
  if(!ts.length)return c.reply(
    `🎁 <b>REWARDS</b>\n━━━━━━━━━━━━━━━━━━\n\n📭 <b>No tasks available</b>\n\nNew earning opportunities will appear here soon.`,
    {parse_mode:'HTML'}
  );
  for(let t of ts)await c.reply(
    `🎁 <b>${esc(t.title)}</b>\n━━━━━━━━━━━━━━━━━━\n\n${esc(t.description||'Complete this task to earn a reward.')}\n\n💰 <b>REWARD</b>  <code>${esc(await setting('currency','₹'))}${Number(t.reward).toFixed(2)}</code>\n🔁 <b>DAILY LIMIT</b>  ${Number(t.daily_limit)}`,
    {parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('🚀  START TASK',`task:${t.id}`)]])}
  );
});

bot.hears('💰 Wallet',async c=>{
  let u=await getUser(c.from.id),cur=await setting('currency','₹'),min=await setting('min_withdrawal','100');
  c.reply(
    `💰 <b>WALLET</b>\n━━━━━━━━━━━━━━━━━━\n\n💵 <b>AVAILABLE</b>\n<code>${cur}${Number(u.balance).toFixed(2)}</code>\n\n🎁 <b>TOTAL EARNED</b>\n<code>${cur}${Number(u.lifetime_earned).toFixed(2)}</code>\n\n📤 <b>TOTAL WITHDRAWN</b>\n<code>${cur}${Number(u.lifetime_withdrawn).toFixed(2)}</code>\n\n━━━━━━━━━━━━━━━━━━\n📌 Minimum withdrawal: <b>${cur}${min}</b>\n\n💳 <b>Withdraw with:</b>\n<code>/withdraw ${min} upi yourupi@bank</code>`,
    {parse_mode:'HTML'}
  );
});

bot.hears('👥 Invite',async c=>{
  let u=await getUser(c.from.id),me=await c.telegram.getMe();
  let s=(await q("SELECT count(*)::int total,count(*) FILTER (WHERE status='qualified')::int qualified,coalesce(sum(reward),0) earned FROM referrals WHERE referrer_id=$1",[u.id])).rows[0];
  c.reply(
    `👥 <b>INVITE &amp; EARN</b>\n━━━━━━━━━━━━━━━━━━\n\n🔗 <b>YOUR REFERRAL LINK</b>\n<code>https://t.me/${esc(me.username)}?start=ref_${c.from.id}</code>\n\n👤 Invited       <b>${s.total}</b>\n✅ Qualified     <b>${s.qualified}</b>\n💰 Earned        <code>${esc(await setting('currency','₹'))}${Number(s.earned).toFixed(2)}</code>\n\n💡 Share your link with friends and earn when referrals qualify.`,
    {parse_mode:'HTML'}
  );
});

bot.hears('👤 Account',async c=>{
  let u=await getUser(c.from.id),cur=await setting('currency','₹');
  c.reply(
    `👤 <b>MY ACCOUNT</b>\n━━━━━━━━━━━━━━━━━━\n\n🆔 <b>TELEGRAM ID</b>\n<code>${u.telegram_id}</code>\n\n💰 <b>BALANCE</b>      <code>${cur}${Number(u.balance).toFixed(2)}</code>\n🎁 <b>EARNED</b>       <code>${cur}${Number(u.lifetime_earned).toFixed(2)}</code>\n📤 <b>WITHDRAWN</b>    <code>${cur}${Number(u.lifetime_withdrawn).toFixed(2)}</code>\n\n━━━━━━━━━━━━━━━━━━\n⚡ <b>Account status:</b> ${esc(u.status)}`,
    {parse_mode:'HTML'}
  );
});

bot.hears('🎟 Gift Code',async c=>{
  c.reply(
    `🎟 <b>GIFT CODE</b>\n━━━━━━━━━━━━━━━━━━\n\n🎁 Have a reward code?\nEnter it below to redeem your reward:\n\n<code>/gift YOURCODE</code>\n\n<i>Each code follows its configured usage limit.</i>`,
    {parse_mode:'HTML'}
  );
});

bot.hears('📜 History',async c=>{
  let u=await getUser(c.from.id),r=(await q('SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 15',[u.id])).rows;
  let body=r.length?r.map(x=>`• <b>${esc(x.type)}</b>  ·  <code>${esc(x.amount)}</code>  ·  ${esc(x.status)}`).join('\n'):'<i>No transactions yet.</i>';
  c.reply(
    `📜 <b>TRANSACTION HISTORY</b>\n━━━━━━━━━━━━━━━━━━\n\n${body}\n\n━━━━━━━━━━━━━━━━━━\nShowing your latest ${Math.min(r.length,15)} transaction(s).`,
    {parse_mode:'HTML'}
  );
});

bot.hears('🆘 Support',async c=>{
  let s=String(process.env.SUPPORT_USERNAME||'not_configured').replace('@','');
  c.reply(
    `🆘 <b>SUPPORT CENTER</b>\n━━━━━━━━━━━━━━━━━━\n\nNeed help with your account, tasks or withdrawal?\n\n👨‍💻 <b>Support:</b> @${esc(s)}\n\nPlease include your Telegram ID when reporting an issue.`,
    {parse_mode:'HTML'}
  );
});

bot.action('tasks',async c=>{await c.answerCbQuery();if(!(await gate(c)))return;let ts=(await q('SELECT * FROM tasks WHERE active ORDER BY id DESC')).rows;if(!ts.length)return c.reply('📭 No tasks available.',menu());for(let t of ts)await c.reply(`🎁 *${t.title}*\n${t.description||''}\n\n💰 Reward: ${await setting('currency','₹')}${Number(t.reward).toFixed(2)}`,{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🚀 Start',`task:${t.id}`)]])})});
bot.action(/^task:(\d+)$/,async c=>{await c.answerCbQuery();if(!(await gate(c)))return;let u=await getUser(c.from.id),t=(await q('SELECT * FROM tasks WHERE id=$1 AND active',[+c.match[1]])).rows[0];if(!t)return c.reply('Task unavailable.');let n=(await q("SELECT count(*)::int n FROM attempts WHERE user_id=$1 AND task_id=$2 AND created_at>=date_trunc('day',NOW())",[u.id,t.id])).rows[0].n;if(n>=t.daily_limit)return c.reply('❌ Daily limit reached.');let a=await q('INSERT INTO attempts(task_id,user_id) VALUES($1,$2) RETURNING id',[t.id,u.id]);c.reply('🚀 Task started. Demo mode uses manual completion. Connect a real provider callback before paying real ad rewards.',Markup.inlineKeyboard([[Markup.button.callback('✅ Complete',`done:${a.rows[0].id}`)]]))});
bot.action(/^done:(\d+)$/,async c=>{await c.answerCbQuery();let u=await getUser(c.from.id),a=(await q('SELECT a.*,t.reward FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE a.id=$1 AND a.user_id=$2',[+c.match[1],u.id])).rows[0];if(!a||a.status!=='started')return c.reply('❌ Invalid or already completed.');let client=await db.connect();try{await client.query('BEGIN');await client.query("UPDATE attempts SET status='completed' WHERE id=$1",[a.id]);await client.query('UPDATE users SET balance=balance+$2,lifetime_earned=lifetime_earned+$2 WHERE id=$1',[u.id,a.reward]);await client.query("INSERT INTO transactions(user_id,type,amount,reference) VALUES($1,'task_reward',$2,$3)",[u.id,a.reward,'TASK-'+a.id]);await client.query('COMMIT');c.reply(`🎉 Reward added: ${await setting('currency','₹')}${Number(a.reward).toFixed(2)}`)}catch(e){await client.query('ROLLBACK');c.reply('❌ '+e.message)}finally{client.release()}});
bot.action('invite',async c=>{await c.answerCbQuery();let u=await getUser(c.from.id),me=await c.telegram.getMe(),s=(await q("SELECT count(*)::int total,count(*) FILTER(WHERE status='qualified')::int qualified,coalesce(sum(reward),0) earned FROM referrals WHERE referrer_id=$1",[u.id])).rows[0];c.reply(`👥 *Invite & Earn*\n\n🔗 https://t.me/${me.username}?start=ref_${c.from.id}\n\n👤 Invited: ${s.total}\n✅ Qualified: ${s.qualified}\n💰 Earned: ${await setting('currency','₹')}${Number(s.earned).toFixed(2)}`,{parse_mode:'Markdown',...menu()})});
bot.action('account',async c=>{await c.answerCbQuery();let u=await getUser(c.from.id),x=await setting('currency','₹');c.reply(`👤 *ACCOUNT*\n\n🆔 ${u.telegram_id}\n💰 Balance: ${x}${Number(u.balance).toFixed(2)}\n🎁 Earned: ${x}${Number(u.lifetime_earned).toFixed(2)}\n💸 Withdrawn: ${x}${Number(u.lifetime_withdrawn).toFixed(2)}`,{parse_mode:'Markdown',...menu()})});
bot.action('cashout',async c=>{await c.answerCbQuery();let u=await getUser(c.from.id),m=await setting('min_withdrawal','100');c.reply(`💸 *CASHOUT*\n\nBalance: ${await setting('currency','₹')}${Number(u.balance).toFixed(2)}\nMinimum: ${m}\n\nUse: /withdraw 120 upi yourupi@bank`,{parse_mode:'Markdown',...menu()})});
bot.command('withdraw',async c=>{if(!(await gate(c)))return;let p=c.message.text.trim().split(/\s+/),a=Number(p[1]),method=p[2],dest=p.slice(3).join(' '),min=Number(await setting('min_withdrawal','100')),u=await getUser(c.from.id);if(!Number.isFinite(a)||a<min||!method||!dest)return c.reply(`Usage: /withdraw ${min} upi yourupi@bank`);let cl=await db.connect();try{await cl.query('BEGIN');let r=await cl.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE',[u.id]);if(Number(r.rows[0].balance)<a)throw Error('Insufficient balance');let w=await cl.query('INSERT INTO withdrawals(user_id,amount,method,destination) VALUES($1,$2,$3,$4) RETURNING id',[u.id,a,method,dest]);await cl.query('UPDATE users SET balance=balance-$2 WHERE id=$1',[u.id,a]);await cl.query("INSERT INTO transactions(user_id,type,amount,status,reference) VALUES($1,'withdrawal',$2,'pending',$3)",[u.id,-a,'WD-'+w.rows[0].id]);await cl.query('COMMIT');c.reply(`⏳ Withdrawal WD-${w.rows[0].id} created.`)}catch(e){await cl.query('ROLLBACK');c.reply('❌ '+e.message)}finally{cl.release()}});
bot.action('history',async c=>{await c.answerCbQuery();let u=await getUser(c.from.id),r=(await q('SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 15',[u.id])).rows;c.reply(r.length?'📜 *History*\n\n'+r.map(x=>`${x.type} | ${x.amount} | ${x.status}`).join('\n'):'📜 No transactions.',{parse_mode:'Markdown',...menu()})});
bot.action('gift',async c=>{await c.answerCbQuery();c.reply('🎟 Use /gift CODE')});bot.command('gift',async c=>{let code=(c.message.text.split(/\s+/)[1]||'').toUpperCase(),u=await getUser(c.from.id),cl=await db.connect();try{await cl.query('BEGIN');let g=(await cl.query('SELECT * FROM gift_codes WHERE code=$1 AND active FOR UPDATE',[code])).rows[0];if(!g)throw Error('Invalid code');if(g.used_count>=g.max_uses)throw Error('No uses left');if((await cl.query('SELECT 1 FROM gift_uses WHERE gift_id=$1 AND user_id=$2',[g.id,u.id])).rows[0])throw Error('Already used');await cl.query('INSERT INTO gift_uses(gift_id,user_id) VALUES($1,$2)',[g.id,u.id]);await cl.query('UPDATE gift_codes SET used_count=used_count+1 WHERE id=$1',[g.id]);await cl.query('UPDATE users SET balance=balance+$2,lifetime_earned=lifetime_earned+$2 WHERE id=$1',[u.id,g.amount]);await cl.query("INSERT INTO transactions(user_id,type,amount,reference) VALUES($1,'gift_code',$2,$3)",[u.id,g.amount,'GIFT-'+g.id]);await cl.query('COMMIT');c.reply(`🎉 Added ${await setting('currency','₹')}${Number(g.amount).toFixed(2)}`)}catch(e){await cl.query('ROLLBACK');c.reply('❌ '+e.message)}finally{cl.release()}});
bot.action('support',async c=>{await c.answerCbQuery();c.reply('🆘 Support: @'+String(process.env.SUPPORT_USERNAME||'not_configured').replace('@',''),menu())});
const app=express();app.use(express.json());app.use(cookieParser());app.get('/health',(req,res)=>res.json({ok:true}));function auth(req,res,next){try{req.admin=jwt.verify(req.cookies.admin,process.env.JWT_SECRET);next()}catch{res.status(401).json({error:'Unauthorized'})}}
app.post('/admin/login',(req,res)=>{if(req.body.username!==process.env.ADMIN_USERNAME||req.body.password!==process.env.ADMIN_PASSWORD)return res.status(401).json({error:'Invalid login'});res.cookie('admin',jwt.sign({u:req.body.username},process.env.JWT_SECRET,{expiresIn:'12h'}),{httpOnly:true,secure:true,sameSite:'lax'});res.json({ok:true})});app.post('/admin/logout',(req,res)=>{res.clearCookie('admin');res.json({ok:true})});
app.get('/admin/api/stats',auth,async(req,res)=>{let a=await q('SELECT count(*)::int n FROM users'),b=await q('SELECT count(*)::int n FROM tasks'),c=await q("SELECT count(*)::int n FROM withdrawals WHERE status='pending'");res.json({users:a.rows[0].n,tasks:b.rows[0].n,pending_withdrawals:c.rows[0].n})});
app.get('/admin/api/withdrawals',auth,async(req,res)=>res.json((await q('SELECT w.*,u.telegram_id,u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 100')).rows));
app.post('/admin/api/task',auth,async(req,res)=>{let r=await q('INSERT INTO tasks(title,description,reward,daily_limit) VALUES($1,$2,$3,$4) RETURNING *',[req.body.title,req.body.description||'',Number(req.body.reward),Number(req.body.daily_limit||1)]);res.json(r.rows[0])});
app.post('/admin/api/channel',auth,async(req,res)=>{let r=await q('INSERT INTO channels(title,chat_id,username,invite_url) VALUES($1,$2,$3,$4) RETURNING *',[req.body.title,req.body.chat_id,req.body.username||null,req.body.invite_url||null]);res.json(r.rows[0])});
app.post('/admin/api/gift',auth,async(req,res)=>{let r=await q('INSERT INTO gift_codes(code,amount,max_uses) VALUES($1,$2,$3) RETURNING *',[String(req.body.code).toUpperCase(),Number(req.body.amount),Number(req.body.max_uses||1)]);res.json(r.rows[0])});
app.post('/admin/api/withdraw/:id/pay',auth,async(req,res)=>{let c=await db.connect();try{await c.query('BEGIN');let w=(await c.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!w||w.status!=='pending')throw Error('Not pending');await c.query("UPDATE withdrawals SET status='paid' WHERE id=$1",[w.id]);await c.query('UPDATE users SET lifetime_withdrawn=lifetime_withdrawn+$2 WHERE id=$1',[w.user_id,w.amount]);await c.query("UPDATE transactions SET status='confirmed' WHERE reference=$1",['WD-'+w.id]);await c.query('COMMIT');res.json({ok:true})}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message})}finally{c.release()}});
app.post('/admin/api/withdraw/:id/reject',auth,async(req,res)=>{let c=await db.connect();try{await c.query('BEGIN');let w=(await c.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!w||w.status!=='pending')throw Error('Not pending');await c.query("UPDATE withdrawals SET status='rejected',note=$2 WHERE id=$1",[w.id,req.body.note||'Rejected']);await c.query('UPDATE users SET balance=balance+$2 WHERE id=$1',[w.user_id,w.amount]);await c.query("INSERT INTO transactions(user_id,type,amount,reference,note) VALUES($1,'refund',$2,$3,$4)",[w.user_id,w.amount,'WD-'+w.id,req.body.note||'Rejected']);await c.query('COMMIT');res.json({ok:true})}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message})}finally{c.release()}});
app.get('/admin',(req,res)=>res.send(`<!doctype html><meta name=viewport content='width=device-width'><title>Reward Admin</title><style>body{font-family:Arial;background:#0d1117;color:#eee;max-width:900px;margin:auto;padding:20px}input,button{padding:10px;margin:4px;border-radius:8px;background:#161b22;color:white;border:1px solid #444}section{background:#161b22;padding:16px;border-radius:12px;margin:15px 0}button{cursor:pointer}</style><h1>⚡ Reward Bot Admin</h1><section id=l>Username <input id=u>Password <input id=p type=password><button onclick=login()>Login</button><b id=m></b></section><section id=a style=display:none><h2>Dashboard</h2><pre id=s></pre><h3>Create Task</h3><input id=tt placeholder=Title><input id=tr type=number placeholder=Reward><button onclick=task()>Create</button><h3>Add Channel</h3><input id=ct placeholder=Title><input id=cc placeholder=@channel><input id=cu placeholder=@username><input id=ci placeholder='Invite URL'><button onclick=channel()>Add</button><h3>Gift Code</h3><input id=gc placeholder=CODE><input id=ga type=number placeholder=Amount><button onclick=gift()>Create</button><h3>Withdrawals</h3><pre id=w></pre></section><script>async function x(u,o={}){let r=await fetch(u,{headers:{'Content-Type':'application/json'},...o}),d=await r.json();if(!r.ok)throw Error(d.error);return d}async function login(){try{await x('/admin/login',{method:'POST',body:JSON.stringify({username:u.value,password:p.value})});l.style.display='none';a.style.display='block';load()}catch(e){m.textContent=e.message}}async function load(){s.textContent=JSON.stringify(await x('/admin/api/stats'),null,2);w.textContent=JSON.stringify(await x('/admin/api/withdrawals'),null,2)}async function task(){await x('/admin/api/task',{method:'POST',body:JSON.stringify({title:tt.value,reward:tr.value})});alert('Created');load()}async function channel(){await x('/admin/api/channel',{method:'POST',body:JSON.stringify({title:ct.value,chat_id:cc.value,username:cu.value,invite_url:ci.value})});alert('Added')}async function gift(){await x('/admin/api/gift',{method:'POST',body:JSON.stringify({code:gc.value,amount:ga.value})});alert('Created')}</script>`));
app.post('/telegram/webhook',async(req,res)=>{if(req.get('X-Telegram-Bot-Api-Secret-Token')!==process.env.WEBHOOK_SECRET)return res.sendStatus(401);try{await bot.handleUpdate(req.body);res.sendStatus(200)}catch(e){console.error(e);res.sendStatus(500)}});
(async()=>{await q(SQL);let port=Number(process.env.PORT||3000);app.listen(port,async()=>{let url=process.env.BASE_URL.replace(/\/$/,'')+'/telegram/webhook';await bot.telegram.setWebhook(url,{secret_token:process.env.WEBHOOK_SECRET,allowed_updates:['message','callback_query']});console.log('READY',url)})})().catch(e=>{console.error(e);process.exit(1)});
