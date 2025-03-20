import {OrganizationType, UserRole} from '@prisma/client'
import * as bcrypt from 'bcrypt'
import {UserRepository} from "../../repositories/user/user.repository";
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import {prisma} from "../../config/db.config";

async function main() {
    // Check if any users exist in the database
    const userCount = await prisma.user.count();

    // Only proceed with seeding if no users exist
    if (userCount === 0) {
        console.log('No users found. Creating initial seed data...');

        if (!process.env.ROOT_PASSWORD) {
            throw new Error('ROOT_PASSWORD env variable is required')
        }

        const hashedPassword = await bcrypt.hash(process.env.ROOT_PASSWORD, 10)

        /** Create local organization */
        const organizationRepository = new OrganizationRepository(prisma)
        const organization = await organizationRepository.create({
            name: 'Local',
            type: OrganizationType.local,
        })

        /** Create admin user */
        const userRepository = new UserRepository(prisma)
        await userRepository.create({
            email: process.env.ROOT_EMAIL,
            password: hashedPassword,
            role: UserRole.root,
            name: 'ROOT Admin',
            organizationId: organization.id,
        })

        console.log('Initial seed data created successfully.');
    } else {
        console.log('Users already exist in the database. Skipping initial seed.');
    }
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
