const { Telegraf, Markup, session } = require('telegraf');
const nodemailer = require('nodemailer');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());

bot.telegram.getMe().then((botInfo) => {
    bot.options.username = botInfo.username;
});

const referrals = {};
const balances = {};
const referralBonusUsed = {};

const transporter = nodemailer.createTransport({
    host: 'smtp.mail.ru',
    port: 465,
    secure: true, // Используем SSL
    auth: {
        user: process.env.EMAIL_USER, // ваш email на Mail.ru
        pass: process.env.EMAIL_PASS  // ваш пароль от почты
    }
});

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

    ctx.reply('Введите ваш email для получения подтверждения:', Markup.removeKeyboard());
});

bot.on('text', (ctx, next) => {
    if (!ctx.session.email && ctx.message.text.includes('@')) {
        ctx.session.email = ctx.message.text;
        return ctx.reply('Спасибо! Теперь выберите действие:',
            Markup.keyboard([
                ['Pay', 'Получить ссылку', 'Проверить счёт']
            ]).oneTime().resize()
        );
    }
    return next();
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

    if (ctx.session.email) {
        const certificateHTML = `
            <h1 style="color: #4CAF50;">СЕРТИФИКАТ ПОДТВЕРЖДЕНИЯ ОПЛАТЫ</h1>
            <p>Здравствуйте, <strong>${ctx.from.first_name}</strong>!</p>
            <p>Вы успешно оплатили <strong>${amount} руб.</strong></p>
            <p>Номер сертификата: <strong>${payload.unique_id}</strong></p>
            <p>Дата: <strong>${new Date().toLocaleDateString()}</strong></p>
            <br>
            <p style="font-style: italic;">Подпись: ___________________</p>
            <p>Спасибо за покупку!</p>
        `;

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: ctx.session.email,
            subject: 'Сертификат подтверждения оплаты',
            html: certificateHTML
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Ошибка при отправке письма:', error);
            } else {
                console.log('Письмо отправлено:', info.response);
            }
        });
    }
});

bot.launch();
