import assert from 'node:assert/strict';
process.loadEnvFile('.env.test.local');
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_SITE_URL,'http://127.0.0.1:5173');
assert.ok(!process.env.RESEND_API_KEY,'QA cannot send real mail.');
process.env.VAPID_PRIVATE_KEY='';
process.argv=[process.argv[0],'next','dev','--webpack','--hostname','127.0.0.1','--port','5173'];
await import('next/dist/bin/next');
