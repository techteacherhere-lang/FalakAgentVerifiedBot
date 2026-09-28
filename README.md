# FalakAgentVerifiedBot — UI Update

This package is a drop-in replacement for the current `index.js` used by the Railway deployment.

## Included
- Premium dark admin control center
- Native Telegram persistent Reply Keyboard
- Private-channel management with Chat ID + invite URL
- Broadcast center for active users
- Task manager
- Gift-code manager
- Withdrawal queue with pay/reject actions
- Dashboard metrics
- Existing PostgreSQL schema preserved
- Automatic creation of the new `broadcasts` table on startup

## Railway
1. Replace the repository `index.js` with the included file.
2. Keep the existing environment variables.
3. Deploy/redeploy.
4. Open `/admin` on the existing Railway domain.

Do not paste secrets into source code. Keep `BOT_TOKEN`, `DATABASE_URL`, `JWT_SECRET`, `WEBHOOK_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` in Railway Variables.

## Private channel
Use a numeric Chat ID such as `-1001234567890` and an invite URL such as `https://t.me/+...`. The bot should be an administrator in the channel so membership checks work reliably.

## Broadcast
The admin Broadcast page sends the message to users whose account status is `active`. The UI shows sent/failed counts. Send only messages you intend to deliver to your users.
