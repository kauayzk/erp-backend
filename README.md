# Tchuka Import's - API

Backend do sistema ERP Tchuka Import's. Responsável por toda a lógica de negócios, autenticação e comunicação com o banco de dados.

## Tecnologias Usadas
- Node.js + Express
- TypeScript
- Prisma ORM
- PostgreSQL
- JWT & Bcrypt (Autenticação)

## Como rodar localmente

1. Instale as dependências:
```bash
npm install
```

2. Crie um arquivo `.env` na raiz do projeto com as suas configurações:
```env
DATABASE_URL="postgres://usuario:senha@localhost:5432/nomedobanco"
JWT_SECRET="sua-chave-secreta"
FRONTEND_URL="*"
```

3. Sincronize o banco de dados:
```bash
npx prisma migrate dev
```

4. Inicie o servidor:
```bash
npm run dev
```
