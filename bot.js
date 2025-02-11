const { Telegraf, Markup, session } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());

bot.telegram.getMe().then((botInfo) => {
    bot.options.username = botInfo.username;
});

// === Webhook настройка ===
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = 'https://tgbot-gev7.onrender.com';

// Установка Webhook
bot.telegram.setWebhook(`${WEBHOOK_URL}/bot${process.env.BOT_TOKEN}`);

// Запуск сервера для Webhook
bot.startWebhook(`/bot${process.env.BOT_TOKEN}`, null, PORT);

// =========================

const referrals = {};
const balances = {};
const referralBonusUsed = {};

const getInvoice = (id, referrerId = null) => {
    const isReferral = referrerId && id.toString() !== referrerId && !referralBonusUsed[id];
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
            unique_id: `${id}_${Number(new Date())}`,
            provider_token: process.env.PROVIDER_TOKEN,
            referrerId: referrerId || null
        })
    };
};

bot.use(Telegraf.log());

bot.start((ctx) => {
    ctx.session = ctx.session || {};
    const referrerId = ctx.message.text.split(' ')[1];

    if (referrerId && referrerId !== ctx.from.id.toString()) {
        ctx.session.referrerId = referrerId;
    }

    balances[ctx.from.id] = balances[ctx.from.id] || 0;
    referralBonusUsed[ctx.from.id] = referralBonusUsed[ctx.from.id] || false;

    ctx.reply('Добро пожаловать! Выберите действие:',
        Markup.keyboard([
            ['Pay', 'Получить ссылку', 'Проверить счёт']
        ]).oneTime().resize()
    );
});

bot.hears('Pay', (ctx) => {
    ctx.session = ctx.session || {};
    const referrerId = ctx.session.referrerId || null;
    return ctx.replyWithInvoice(getInvoice(ctx.from.id, referrerId));
});

bot.hears('Получить ссылку', (ctx) => {
    const referralLink = `https://t.me/${bot.options.username}?start=${ctx.from.id}`;
    referrals[ctx.from.id] = ctx.from.id;
    return ctx.reply(`Ваша реферальная ссылка: ${referralLink}`);
});

bot.hears('Проверить счёт', (ctx) => {
    const balance = balances[ctx.from.id] || 0;
    return ctx.reply(`Ваш текущий баланс: ${balance} руб.`);
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
    const amount = ctx.message.successful_payment.total_amount / 100;
    const payload = JSON.parse(ctx.message.successful_payment.invoice_payload);
    const referrerId = payload.referrerId;

    balances[ctx.from.id] += 150;

    if (referrerId && referrerId !== ctx.from.id.toString() && !referralBonusUsed[ctx.from.id]) {
        balances[referrerId] = (balances[referrerId] || 0) + 50;
        referralBonusUsed[ctx.from.id] = true;
    }

    await ctx.reply('Платёж успешно выполнен! ✅');
});
