import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const user = await prisma.user.findFirst();
    if (!user) {
      console.log('No user found');
      return;
    }
    
    console.log('Testing category creation for user:', user.id);
    const category = await prisma.category.create({
      data: {
        name: 'test-category',
        type: 'outcome',
        userId: user.id
      }
    });
    console.log('Category created:', category);
    
    await prisma.category.delete({ where: { id: category.id } });
    console.log('Category deleted');
    
  } catch (err) {
    console.error('Error creating category:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
