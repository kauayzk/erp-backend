"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authMiddleware_1 = require("./middlewares/authMiddleware");
const zod_1 = require("zod");
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const app = (0, express_1.default)();
if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não está definida.');
}
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não está definida.');
}
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || '*'
}));
app.use(express_1.default.json());
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // Limite de 10 tentativas por IP
    message: { error: 'Muitas tentativas de login. Tente novamente após 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});
// ==========================================
// MÓDULO: USUÁRIOS E AUTENTICAÇÃO
// ==========================================
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const user = await prisma.user.create({
            data: { name, email, password: hashedPassword, role: 'OWNER' },
        });
        return res.status(201).json({ message: 'Usuário criado com sucesso!', userId: user.id });
    }
    catch (error) {
        return res.status(400).json({ error: 'Erro ao criar usuário, verifique os dados ou se o email já existe.' });
    }
});
app.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (process.env.DEV_EMAIL &&
        process.env.DEV_PASSWORD &&
        email === process.env.DEV_EMAIL &&
        password === process.env.DEV_PASSWORD) {
        const token = jsonwebtoken_1.default.sign({ userId: 'DEV_MASTER', role: 'DEV' }, process.env.JWT_SECRET, { expiresIn: '1d' });
        return res.status(200).json({
            message: 'Login bem-sucedido!',
            token,
            user: { id: 'DEV_MASTER', name: 'Desenvolvedor Master', email: process.env.DEV_EMAIL, role: 'DEV' }
        });
    }
    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user)
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        const isPasswordValid = await bcrypt_1.default.compare(password, user.password);
        if (!isPasswordValid)
            return res.status(401).json({ error: 'Senha incorreta.' });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1d' });
        return res.status(200).json({
            message: 'Login bem-sucedido!',
            token,
            user: { id: user.id, name: user.name, email: user.email }
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});
app.get('/perfil', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        if (req.role === 'DEV') {
            return res.status(200).json({ id: 'DEV_MASTER', name: 'Desenvolvedor Master', email: 'dev@master.com', role: 'DEV' });
        }
        const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, email: true, role: true } });
        if (!user)
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        return res.status(200).json(user);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar perfil.' });
    }
});
// ==========================================
// MÓDULO: CATEGORIAS E TRANSAÇÕES (FINANCEIRO)
// ==========================================
app.post('/categories', authMiddleware_1.authMiddleware, async (req, res) => {
    const { name, type } = req.body;
    try {
        const category = await prisma.category.create({ data: { name, type, userId: req.userId } });
        return res.status(201).json(category);
    }
    catch (error) {
        console.error("Erro detalhado ao criar categoria:", error);
        return res.status(500).json({ error: 'Erro ao criar categoria.', details: error.message || error });
    }
});
app.get('/categories', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const whereCondition = req.role === 'DEV' ? {} : { userId: req.userId };
        const categories = await prisma.category.findMany({ where: whereCondition });
        return res.status(200).json(categories);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar categories.' });
    }
});
app.delete('/categories/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const category = await prisma.category.findUnique({ where: { id: req.params.id } });
        if (!category || (category.userId !== req.userId && req.role !== 'DEV'))
            return res.status(403).json({ error: 'Sem permissão.' });
        await prisma.category.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao deletar categoria.' });
    }
});
const transactionSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, 'O título é obrigatório.'),
    amount: zod_1.z.number().positive('O valor deve ser positivo.'),
    type: zod_1.z.string().refine((val) => val === 'income' || val === 'outcome'),
    categoryId: zod_1.z.string().optional().nullable(),
    status: zod_1.z.enum(['PAID', 'PENDING']).optional().default('PAID'),
    dueDate: zod_1.z.string().optional().nullable(),
    cashRegisterId: zod_1.z.string().optional().nullable(),
    paymentMethod: zod_1.z.string().optional().nullable(),
    isPersonal: zod_1.z.boolean().optional().default(false),
    clientId: zod_1.z.string().optional().nullable(),
});
app.post('/transactions', authMiddleware_1.authMiddleware, async (req, res) => {
    const parsedData = transactionSchema.safeParse(req.body);
    if (!parsedData.success)
        return res.status(400).json({ error: parsedData.error.issues[0].message });
    const data = parsedData.data;
    try {
        // Validação de limite de crédito se for Fiado (status PENDING e clientId informado)
        if (data.type === 'income' && data.status === 'PENDING' && data.clientId) {
            const client = await prisma.client.findUnique({
                where: { id: data.clientId },
                include: {
                    transactions: {
                        where: {
                            type: 'income',
                            status: 'PENDING'
                        }
                    }
                }
            });
            if (!client) {
                return res.status(404).json({ error: 'Cliente não encontrado.' });
            }
            const currentDebt = client.transactions.reduce((sum, t) => sum + Number(t.amount), 0);
            const limit = Number(client.creditLimit);
            if (currentDebt + data.amount > limit) {
                return res.status(400).json({
                    error: `Limite de fiado excedido. Limite disponível: R$ ${(limit - currentDebt).toFixed(2)}. Valor do lançamento: R$ ${data.amount.toFixed(2)}.`
                });
            }
        }
        const transaction = await prisma.$transaction(async (tx) => {
            const newTransaction = await tx.transaction.create({
                data: {
                    title: data.title,
                    amount: data.amount,
                    type: data.type,
                    userId: req.userId,
                    categoryId: data.categoryId || null,
                    status: data.status,
                    dueDate: data.dueDate ? new Date(data.dueDate) : null,
                    cashRegisterId: data.cashRegisterId || null,
                    paymentMethod: data.paymentMethod || null,
                    isPersonal: data.isPersonal,
                    clientId: data.clientId || null,
                },
            });
            if (data.status === 'PAID' && data.paymentMethod === 'CASH' && data.cashRegisterId) {
                if (data.type === 'income') {
                    await tx.cashRegister.update({
                        where: { id: data.cashRegisterId },
                        data: { currentBalance: { increment: data.amount } }
                    });
                }
                else if (data.type === 'outcome') {
                    await tx.cashRegister.update({
                        where: { id: data.cashRegisterId },
                        data: { currentBalance: { decrement: data.amount } }
                    });
                }
            }
            return newTransaction;
        });
        return res.status(201).json(transaction);
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao criar transação.' });
    }
});
app.patch('/transactions/:id/pay', authMiddleware_1.authMiddleware, async (req, res) => {
    const { paymentMethod, cashRegisterId } = req.body;
    try {
        const whereCondition = req.role === 'DEV' ? { id: req.params.id } : { id: req.params.id, userId: req.userId };
        const transaction = await prisma.$transaction(async (tx) => {
            const existing = await tx.transaction.findUnique({ where: whereCondition });
            if (!existing)
                throw new Error("Not found");
            const updated = await tx.transaction.update({
                where: whereCondition,
                data: { status: 'PAID', paymentMethod: paymentMethod || existing.paymentMethod, cashRegisterId: cashRegisterId || existing.cashRegisterId, createdAt: new Date() },
            });
            if ((paymentMethod === 'CASH' || updated.paymentMethod === 'CASH') && updated.cashRegisterId) {
                if (updated.type === 'income') {
                    await tx.cashRegister.update({ where: { id: updated.cashRegisterId }, data: { currentBalance: { increment: updated.amount } } });
                }
                else if (updated.type === 'outcome') {
                    await tx.cashRegister.update({ where: { id: updated.cashRegisterId }, data: { currentBalance: { decrement: updated.amount } } });
                }
            }
            return updated;
        });
        return res.status(200).json(transaction);
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao processar o pagamento.' });
    }
});
app.get('/transactions', authMiddleware_1.authMiddleware, async (req, res) => {
    const { month, year, type } = req.query;
    let whereCondition = req.role === 'DEV' ? {} : { userId: req.userId };
    if (month && year) {
        whereCondition.createdAt = {
            gte: new Date(Number(year), Number(month) - 1, 1),
            lt: new Date(Number(year), Number(month), 1),
        };
    }
    if (type === 'income' || type === 'outcome') {
        whereCondition.type = type;
    }
    try {
        const transactions = await prisma.transaction.findMany({
            where: whereCondition,
            include: {
                category: true,
                client: true, // <-- Inclui a entidade vinculada
            },
            orderBy: { createdAt: 'desc' }
        });
        return res.status(200).json(transactions);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar transações.' });
    }
});
app.get('/balance', authMiddleware_1.authMiddleware, async (req, res) => {
    const { month, year } = req.query;
    let dateFilter = {};
    if (month && year) {
        dateFilter = {
            createdAt: {
                gte: new Date(Number(year), Number(month) - 1, 1),
                lt: new Date(Number(year), Number(month), 1),
            },
        };
    }
    try {
        const whereCondition = req.role === 'DEV' ? { status: 'PAID', ...dateFilter } : { userId: req.userId, status: 'PAID', ...dateFilter };
        const transactions = await prisma.transaction.findMany({ where: whereCondition });
        const income = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + Number(t.amount), 0);
        const outcome = transactions.filter(t => t.type === 'outcome').reduce((acc, t) => acc + Number(t.amount), 0);
        return res.status(200).json({ income, outcome, total: income - outcome });
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao calcular o saldo.' });
    }
});
app.delete('/transactions/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
        if (!transaction)
            return res.status(404).json({ error: 'Transação não encontrada.' });
        if (transaction.userId !== req.userId && req.role !== 'DEV')
            return res.status(403).json({ error: 'Sem permissão.' });
        await prisma.transaction.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao deletar a transação.' });
    }
});
app.put('/transactions/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
        if (!transaction)
            return res.status(404).json({ error: 'Transação não encontrada.' });
        if (transaction.userId !== req.userId)
            return res.status(403).json({ error: 'Sem permissão.' });
        const updated = await prisma.transaction.update({
            where: { id: req.params.id },
            data: req.body,
        });
        return res.status(200).json(updated);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao atualizar a transação.' });
    }
});
// ==========================================
// MÓDULO: PRODUTOS (COM FORNECEDORES)
// ==========================================
const productSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    internalCode: zod_1.z.string().optional().nullable(),
    barcode: zod_1.z.string().optional().nullable(),
    costPrice: zod_1.z.number().positive(),
    salePrice: zod_1.z.number().positive(),
    stockQuantity: zod_1.z.number().int().nonnegative(),
    minStock: zod_1.z.number().int().nonnegative().optional().default(5),
    location: zod_1.z.string().optional().nullable(),
    categoryId: zod_1.z.string().optional().nullable(),
    supplierId: zod_1.z.string().optional().nullable(),
});
app.post('/products', authMiddleware_1.authMiddleware, async (req, res) => {
    const parsedData = productSchema.safeParse(req.body);
    if (!parsedData.success)
        return res.status(400).json({ error: parsedData.error.issues[0].message });
    const data = parsedData.data;
    try {
        const product = await prisma.product.create({
            data: {
                name: data.name,
                internalCode: data.internalCode || null,
                barcode: data.barcode || null,
                costPrice: data.costPrice,
                salePrice: data.salePrice,
                stockQuantity: data.stockQuantity,
                minStock: data.minStock,
                location: data.location || null,
                categoryId: data.categoryId || null,
                supplierId: data.supplierId || null,
                userId: req.userId,
            },
        });
        return res.status(201).json(product);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao criar produto.' });
    }
});
app.get('/products', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const whereCondition = req.role === 'DEV' ? {} : { userId: req.userId };
        const products = await prisma.product.findMany({
            where: whereCondition,
            include: { category: true, supplier: true }
        });
        return res.status(200).json(products);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar produtos.' });
    }
});
app.put('/products/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    const id = req.params.id;
    try {
        const existingProduct = await prisma.product.findUnique({ where: { id } });
        if (!existingProduct || (existingProduct.userId !== req.userId && req.role !== 'DEV'))
            return res.status(404).json({ error: 'Produto não encontrado ou sem permissão.' });
        const updatedProduct = await prisma.product.update({
            where: { id },
            data: {
                ...req.body,
                costPrice: req.body.costPrice ? Number(req.body.costPrice) : existingProduct.costPrice,
                salePrice: req.body.salePrice ? Number(req.body.salePrice) : existingProduct.salePrice,
                stockQuantity: req.body.stockQuantity ? Number(req.body.stockQuantity) : existingProduct.stockQuantity,
                minStock: req.body.minStock ? Number(req.body.minStock) : existingProduct.minStock,
                supplierId: req.body.supplierId !== undefined ? (req.body.supplierId || null) : existingProduct.supplierId,
            },
        });
        return res.status(200).json(updatedProduct);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao atualizar o produto.' });
    }
});
app.delete('/products/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const product = await prisma.product.findUnique({ where: { id: req.params.id } });
        if (!product || (product.userId !== req.userId && req.role !== 'DEV'))
            return res.status(403).json({ error: 'Sem permissão.' });
        await prisma.product.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao deletar produto.' });
    }
});
// ==========================================
// MÓDULO: CAIXA E FRENTE DE LOJA (PDV)
// ==========================================
app.get('/cash-registers/current', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const cashRegister = await prisma.cashRegister.findFirst({ where: { ...(req.role === 'DEV' ? {} : { userId: req.userId }), status: 'OPEN' } });
        return res.status(200).json(cashRegister);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar status do caixa.' });
    }
});
app.post('/cash-registers', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const existing = await prisma.cashRegister.findFirst({ where: { userId: req.userId, status: 'OPEN' } });
        if (existing)
            return res.status(400).json({ error: 'Já existe um caixa aberto.' });
        const cashRegister = await prisma.cashRegister.create({
            data: { initialBalance: Number(req.body.initialBalance) || 0, currentBalance: Number(req.body.initialBalance) || 0, userId: req.userId, status: 'OPEN' },
        });
        return res.status(201).json(cashRegister);
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao abrir o caixa.' });
    }
});
app.post('/cash-registers/:id/sangria', authMiddleware_1.authMiddleware, async (req, res) => {
    const { amount, reason } = req.body;
    if (!amount || Number(amount) <= 0)
        return res.status(400).json({ error: 'Informe um valor válido.' });
    try {
        const cashRegister = await prisma.cashRegister.findUnique({ where: { id: req.params.id } });
        if (!cashRegister || cashRegister.status !== 'OPEN')
            return res.status(400).json({ error: 'Caixa fechado.' });
        const transaction = await prisma.$transaction(async (tx) => {
            const t = await tx.transaction.create({
                data: {
                    title: `Sangria: ${reason || 'Retirada parcial'}`,
                    amount: Number(amount),
                    type: 'outcome',
                    paymentMethod: 'CASH',
                    userId: req.userId,
                    cashRegisterId: req.params.id,
                },
            });
            await tx.cashRegister.update({
                where: { id: req.params.id },
                data: { currentBalance: { decrement: Number(amount) } }
            });
            return t;
        });
        return res.status(201).json(transaction);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao processar sangria.' });
    }
});
app.put('/cash-registers/:id/close', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const cashRegister = await prisma.cashRegister.update({
            where: { id: req.params.id },
            data: { status: 'CLOSED', closedAt: new Date(), finalBalance: Number(req.body.finalBalance) },
        });
        return res.status(200).json(cashRegister);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao fechar o caixa.' });
    }
});
const saleSchema = zod_1.z.object({
    cashRegisterId: zod_1.z.string(),
    paymentMethod: zod_1.z.string(),
    clientId: zod_1.z.string().optional().nullable(),
    items: zod_1.z.array(zod_1.z.object({ productId: zod_1.z.string(), quantity: zod_1.z.number().positive(), unitPrice: zod_1.z.number().positive() })).min(1),
    discount: zod_1.z.number().nonnegative().optional(),
});
app.post('/sales', authMiddleware_1.authMiddleware, async (req, res) => {
    const parsedData = saleSchema.safeParse(req.body);
    if (!parsedData.success)
        return res.status(400).json({ error: parsedData.error.issues[0].message });
    const { cashRegisterId, paymentMethod, clientId, items, discount } = parsedData.data;
    const subtotal = items.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
    const total = Math.max(0, subtotal - (discount || 0));
    if (paymentMethod === 'FIADO') {
        if (!clientId) {
            return res.status(400).json({ error: 'Para vendas fiadas, você deve informar o cliente.' });
        }
        try {
            const client = await prisma.client.findUnique({
                where: { id: clientId },
                include: {
                    transactions: {
                        where: {
                            type: 'income',
                            status: 'PENDING'
                        }
                    }
                }
            });
            if (!client) {
                return res.status(404).json({ error: 'Cliente não encontrado para venda fiada.' });
            }
            const currentDebt = client.transactions.reduce((sum, t) => sum + Number(t.amount), 0);
            const limit = Number(client.creditLimit);
            if (currentDebt + total > limit) {
                return res.status(400).json({
                    error: `Limite de fiado excedido. Limite disponível: R$ ${(limit - currentDebt).toFixed(2)}. Valor total da venda: R$ ${total.toFixed(2)}.`
                });
            }
        }
        catch (err) {
            return res.status(500).json({ error: 'Erro ao validar limite de fiado do cliente.' });
        }
    }
    try {
        const sale = await prisma.$transaction(async (tx) => {
            const newSale = await tx.sale.create({
                data: {
                    total, paymentMethod, cashRegisterId, clientId: clientId || null,
                    userId: req.userId,
                    items: { create: items.map(item => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: item.quantity * item.unitPrice })) }
                }
            });
            for (const item of items) {
                await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: { decrement: item.quantity } } });
            }
            await tx.transaction.create({
                data: {
                    title: `Venda PDV #${newSale.id.substring(0, 6).toUpperCase()}${paymentMethod === 'FIADO' ? ' (Fiado)' : ''}`,
                    amount: total,
                    type: 'income',
                    paymentMethod,
                    status: paymentMethod === 'FIADO' ? 'PENDING' : 'PAID',
                    userId: req.userId,
                    cashRegisterId,
                    clientId: clientId || null,
                },
            });
            if (paymentMethod === 'CASH' && cashRegisterId) {
                await tx.cashRegister.update({
                    where: { id: cashRegisterId },
                    data: { currentBalance: { increment: total } }
                });
            }
            return newSale;
        });
        return res.status(201).json(sale);
    }
    catch (error) {
        console.error("Erro ao processar a venda:", error);
        return res.status(500).json({ error: 'Erro ao processar a venda.' });
    }
});
app.post('/cash-registers/:id/third-party-bill', authMiddleware_1.authMiddleware, async (req, res) => {
    const { billTitle, billAmount, feeAmount } = req.body;
    if (!billTitle || !billAmount)
        return res.status(400).json({ error: 'Informe a descrição e o valor.' });
    try {
        const transaction = await prisma.transaction.create({
            data: {
                title: `Taxa de Serviço: ${billTitle} (Boleto de R$ ${Number(billAmount).toFixed(2)})`,
                amount: Number(feeAmount) || 0,
                type: 'income',
                userId: req.userId,
                cashRegisterId: req.params.id,
            },
        });
        return res.status(201).json({ message: 'Sucesso', transaction, totalReceived: Number(billAmount) + (Number(feeAmount) || 0) });
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao processar pagamento.' });
    }
});
// ==========================================
// MÓDULO: CLIENTES E FORNECEDORES
// ==========================================
const personSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    email: zod_1.z.string().email().optional().nullable().or(zod_1.z.literal('')),
    phone: zod_1.z.string().optional().nullable(),
    document: zod_1.z.string().optional().nullable(),
    address: zod_1.z.string().optional().nullable(),
    creditLimit: zod_1.z.number().nonnegative().optional(),
});
app.get('/clients', authMiddleware_1.authMiddleware, async (req, res) => {
    const whereCondition = req.role === 'DEV' ? {} : { userId: req.userId };
    const clients = await prisma.client.findMany({ where: whereCondition, orderBy: { name: 'asc' } });
    return res.status(200).json(clients);
});
app.post('/clients', authMiddleware_1.authMiddleware, async (req, res) => {
    const parsedData = personSchema.safeParse(req.body);
    if (!parsedData.success)
        return res.status(400).json({ error: parsedData.error.issues[0].message });
    const client = await prisma.client.create({ data: { ...parsedData.data, userId: req.userId } });
    return res.status(201).json(client);
});
app.put('/clients/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    const existing = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!existing || (existing.userId !== req.userId && req.role !== 'DEV'))
        return res.status(403).json({ error: 'Sem permissão.' });
    const updated = await prisma.client.update({ where: { id: req.params.id }, data: req.body });
    return res.status(200).json(updated);
});
app.delete('/clients/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const existing = await prisma.client.findUnique({ where: { id: req.params.id } });
        if (!existing || (existing.userId !== req.userId && req.role !== 'DEV'))
            return res.status(403).json({ error: 'Sem permissão.' });
        await prisma.client.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch (error) {
        return res.status(400).json({ error: 'Não é possível deletar com vínculos.' });
    }
});
app.get('/suppliers', authMiddleware_1.authMiddleware, async (req, res) => {
    const whereCondition = req.role === 'DEV' ? {} : { userId: req.userId };
    const suppliers = await prisma.supplier.findMany({ where: whereCondition, orderBy: { name: 'asc' } });
    return res.status(200).json(suppliers);
});
app.post('/suppliers', authMiddleware_1.authMiddleware, async (req, res) => {
    const parsedData = personSchema.safeParse(req.body);
    if (!parsedData.success)
        return res.status(400).json({ error: parsedData.error.issues[0].message });
    try {
        const supplier = await prisma.supplier.create({ data: { ...parsedData.data, userId: req.userId } });
        return res.status(201).json(supplier);
    }
    catch (error) {
        console.error("Erro detalhado ao criar fornecedor:", error);
        return res.status(500).json({ error: 'Erro ao criar fornecedor.', details: error.message || error });
    }
});
app.put('/suppliers/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!existing || (existing.userId !== req.userId && req.role !== 'DEV'))
        return res.status(403).json({ error: 'Sem permissão.' });
    const updated = await prisma.supplier.update({ where: { id: req.params.id }, data: req.body });
    return res.status(200).json(updated);
});
app.delete('/suppliers/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
        if (!existing || (existing.userId !== req.userId && req.role !== 'DEV'))
            return res.status(403).json({ error: 'Sem permissão.' });
        await prisma.supplier.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch (error) {
        return res.status(400).json({ error: 'Não é possível deletar com vínculos.' });
    }
});
// ==========================================
// MÓDULO: CONTROLE DE FIADO (DÉBITOS DE CLIENTES)
// ==========================================
app.get('/fiados', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const whereCondition = req.role === 'DEV' ? {} : { userId: req.userId };
        const clientsWithFiados = await prisma.client.findMany({
            where: {
                ...whereCondition,
                transactions: {
                    some: {
                        type: 'income',
                        status: 'PENDING',
                    }
                }
            },
            include: {
                transactions: {
                    where: {
                        type: 'income',
                        status: 'PENDING',
                    },
                    orderBy: {
                        createdAt: 'desc',
                    }
                }
            }
        });
        const result = clientsWithFiados.map(client => {
            const totalDebt = client.transactions.reduce((sum, t) => sum + Number(t.amount), 0);
            return {
                id: client.id,
                name: client.name,
                document: client.document,
                phone: client.phone,
                totalDebt,
                transactions: client.transactions,
            };
        });
        return res.status(200).json(result);
    }
    catch (error) {
        console.error("Erro ao buscar fiados:", error);
        return res.status(500).json({ error: 'Erro ao buscar fiados.' });
    }
});
app.post('/clients/:id/pay-fiado', authMiddleware_1.authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { paymentMethod, cashRegisterId } = req.body;
    try {
        await prisma.$transaction(async (tx) => {
            const pendingTransactions = await tx.transaction.findMany({
                where: { clientId: id, type: 'income', status: 'PENDING' }
            });
            const totalPaid = pendingTransactions.reduce((acc, t) => acc + Number(t.amount), 0);
            await tx.transaction.updateMany({
                where: { clientId: id, type: 'income', status: 'PENDING' },
                data: { status: 'PAID', paymentMethod: paymentMethod || 'CASH', cashRegisterId: cashRegisterId || null, createdAt: new Date() }
            });
            if (paymentMethod === 'CASH' && cashRegisterId) {
                await tx.cashRegister.update({
                    where: { id: cashRegisterId },
                    data: { currentBalance: { increment: totalPaid } }
                });
            }
        });
        return res.status(200).json({ message: 'Fiados baixados com sucesso!' });
    }
    catch (error) {
        console.error("Erro ao dar baixa nos fiados:", error);
        return res.status(500).json({ error: 'Erro ao dar baixa nos fiados.' });
    }
});
app.post('/clients/:id/pay-fiado-partial', authMiddleware_1.authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { amount, cashRegisterId } = req.body;
    if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Informe um valor válido maior que zero.' });
    }
    try {
        const client = await prisma.client.findUnique({
            where: { id: id },
            include: {
                transactions: {
                    where: {
                        type: 'income',
                        status: 'PENDING',
                    },
                    orderBy: {
                        createdAt: 'asc',
                    }
                }
            }
        });
        if (!client)
            return res.status(404).json({ error: 'Cliente não encontrado.' });
        const totalDebt = client.transactions.reduce((sum, t) => sum + Number(t.amount), 0);
        const payAmount = Math.min(Number(amount), totalDebt);
        if (payAmount <= 0) {
            return res.status(400).json({ error: 'Este cliente não possui fiados pendentes.' });
        }
        await prisma.$transaction(async (tx) => {
            // 1. Registra a entrada do dinheiro no caixa
            await tx.transaction.create({
                data: {
                    title: `Baixa Parcial Fiado - ${client.name}`,
                    amount: payAmount,
                    type: 'income',
                    status: 'PAID',
                    paymentMethod: req.body.paymentMethod || 'CASH',
                    userId: req.userId,
                    cashRegisterId: cashRegisterId || null,
                    clientId: client.id,
                }
            });
            if ((req.body.paymentMethod === 'CASH' || !req.body.paymentMethod) && cashRegisterId) {
                await tx.cashRegister.update({
                    where: { id: cashRegisterId },
                    data: { currentBalance: { increment: payAmount } }
                });
            }
            // 2. Abate das contas do fiado
            let remaining = payAmount;
            for (const t of client.transactions) {
                if (remaining <= 0)
                    break;
                const tAmount = Number(t.amount);
                if (tAmount <= remaining) {
                    await tx.transaction.update({
                        where: { id: t.id },
                        data: { status: 'PAID' }
                    });
                    remaining -= tAmount;
                }
                else {
                    await tx.transaction.update({
                        where: { id: t.id },
                        data: { amount: tAmount - remaining }
                    });
                    remaining = 0;
                }
            }
        });
        return res.status(200).json({ message: 'Pagamento parcial registrado com sucesso!', paidAmount: payAmount });
    }
    catch (error) {
        console.error("Erro ao registrar pagamento parcial:", error);
        return res.status(500).json({ error: 'Erro ao registrar pagamento parcial.' });
    }
});
app.get('/sales/top-products', authMiddleware_1.authMiddleware, async (req, res) => {
    const month = req.query.month;
    const year = req.query.year;
    try {
        const startDate = new Date(Number(year || new Date().getFullYear()), Number(month || new Date().getMonth() + 1) - 1, 1);
        const endDate = new Date(Number(year || new Date().getFullYear()), Number(month || new Date().getMonth() + 1), 1);
        const sales = await prisma.sale.findMany({
            where: {
                ...(req.role === 'DEV' ? {} : { userId: req.userId }),
                createdAt: {
                    gte: startDate,
                    lt: endDate,
                }
            },
            include: {
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });
        const productSalesMap = {};
        for (const sale of sales) {
            for (const item of sale.items) {
                const prodId = item.productId;
                if (!productSalesMap[prodId]) {
                    productSalesMap[prodId] = {
                        name: item.product.name,
                        quantity: 0,
                        totalRevenue: 0,
                    };
                }
                productSalesMap[prodId].quantity += item.quantity;
                productSalesMap[prodId].totalRevenue += Number(item.totalPrice);
            }
        }
        const sortedProducts = Object.values(productSalesMap)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);
        return res.status(200).json(sortedProducts);
    }
    catch (error) {
        console.error("Erro ao buscar top produtos:", error);
        return res.status(500).json({ error: 'Erro ao buscar top produtos.' });
    }
});
// ==========================================
// MÓDULO: ADMIN (MASTER DEV)
// ==========================================
const requireDevRole = (req, res, next) => {
    if (req.role !== 'DEV')
        return res.status(403).json({ error: 'Acesso restrito ao Desenvolvedor Master.' });
    next();
};
app.get('/admin/users', authMiddleware_1.authMiddleware, requireDevRole, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            include: {
                _count: {
                    select: { products: true, clients: true, transactions: true, sales: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        return res.status(200).json(users);
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar usuários do sistema.' });
    }
});
app.delete('/admin/users/:id', authMiddleware_1.authMiddleware, requireDevRole, async (req, res) => {
    try {
        const userId = req.params.id;
        await prisma.user.delete({ where: { id: userId } });
        return res.status(204).send();
    }
    catch (error) {
        console.error("Erro ao deletar usuário:", error);
        return res.status(500).json({ error: 'Erro ao deletar o usuário.' });
    }
});
app.get('/admin/stats', authMiddleware_1.authMiddleware, requireDevRole, async (req, res) => {
    try {
        const totalUsers = await prisma.user.count();
        const totalSalesAgg = await prisma.sale.aggregate({ _sum: { total: true } });
        const totalTransactionsAgg = await prisma.transaction.aggregate({ _sum: { amount: true } });
        return res.status(200).json({
            totalUsers,
            totalSalesVolume: totalSalesAgg._sum.total || 0,
            totalTransactionsVolume: totalTransactionsAgg._sum.amount || 0
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar estatísticas globais.' });
    }
});
app.post('/admin/impersonate/:id', authMiddleware_1.authMiddleware, requireDevRole, async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (!targetUser)
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        // Generate a token as if we are the target user
        const token = jsonwebtoken_1.default.sign({ userId: targetUser.id, role: targetUser.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
        return res.status(200).json({
            message: 'Impersonation bem-sucedida!',
            token,
            user: { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role }
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Erro ao personificar o usuário.' });
    }
});
app.listen(3333, () => console.log('Servidor rodando na porta 3333'));
