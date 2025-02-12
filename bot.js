const { Telegraf, Markup, session } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

// Подключение к PostgreSQL
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect();

// Создание таблицы, если не существует
client.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    balance INTEGER DEFAULT 0,
    referrer_id BIGINT,
    referral_bonus_used BOOLEAN DEFAULT FALSE
  )
`);

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());

bot.telegram.getMe().then((botInfo) => {
    bot.options.username = botInfo.username;
});

// Функции для работы с базой данных
async function getUser(userId) {
    const res = await client.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
    return res.rows[0];
}

async function createUser(userId, referrerId = null) {
    await client.query(
        'INSERT INTO users (telegram_id, referrer_id) VALUES ($1, $2) ON CONFLICT (telegram_id) DO NOTHING',
        [userId, referrerId]
    );
}

async function updateBalance(userId, amount) {
    await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [amount, userId]
    );
}

async function markReferralBonusUsed(userId) {
    await client.query(
        'UPDATE users SET referral_bonus_used = TRUE WHERE telegram_id = $1',
        [userId]
    );
}

async function hasUsedReferralBonus(userId) {
    const user = await getUser(userId);
    return user?.referral_bonus_used || false;
}

const getInvoice = async (id, referrerId = null) => {
    const isReferral = referrerId && id.toString() !== referrerId && !(await hasUsedReferralBonus(id));
    const amount = isReferral ? 125 * 100 : 150 * 100;
    const description = isReferral ? 'Вы получили скидку 25 рублей!' : 'InvoiceDescription';

    return {
        chat_id: id,
        provider_token: process.env.PROVIDER_TOKEN,
        start_parameter: 'get_access',
        title: 'InvoiceTitle',
        description,
        currency: 'RUB',
        prices: [{ label: 'Invoice Title', amount }],
        payload: JSON.stringify({
            unique_id: `${id}_${Date.now()}`,
            provider_token: process.env.PROVIDER_TOKEN,
            referrerId: referrerId || null,
        }),
    };
};

bot.use(Telegraf.log());

bot.start(async (ctx) => {
    const referrerId = ctx.message.text.split(' ')[1];
    await createUser(ctx.from.id, referrerId);

    ctx.session = ctx.session || {};
    if (referrerId && referrerId !== ctx.from.id.toString()) {
        ctx.session.referrerId = referrerId;
    }

    ctx.reply('Добро пожаловать! Выберите действие:',
        Markup.keyboard([
            ['Pay', 'Получить ссылку', 'Проверить счёт']
        ]).oneTime().resize()
    );
});

bot.hears('Pay', async (ctx) => {
    const referrerId = ctx.session?.referrerId || null;
    return ctx.replyWithInvoice(await getInvoice(ctx.from.id, referrerId));
});

bot.hears('Получить ссылку', (ctx) => {
    const referralLink = `https://t.me/${bot.options.username}?start=${ctx.from.id}`;
    return ctx.reply(`Ваша реферальная ссылка: ${referralLink}`);
});

bot.hears('Проверить счёт', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const balance = user?.balance || 0;
    return ctx.reply(`Ваш текущий баланс: ${balance} руб.`);
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
    const amount = ctx.message.successful_payment.total_amount / 100;
    const payload = JSON.parse(ctx.message.successful_payment.invoice_payload);
    const referrerId = payload.referrerId;

    await updateBalance(ctx.from.id, 150);

    if (referrerId && referrerId !== ctx.from.id.toString() && !(await hasUsedReferralBonus(ctx.from.id))) {
        await updateBalance(referrerId, 50);
        await markReferralBonusUsed(ctx.from.id);
    }

    await ctx.reply('Платёж успешно выполнен! ✅');
});

bot.launch();
