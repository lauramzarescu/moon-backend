import {AccessControlRepository} from '../../repositories/access-control/access-control.repository';
import {prisma} from '../../config/db.config';

const repository = new AccessControlRepository(prisma);

export class AccessControlHelper {
    checkAccess = async (email: string, organizationId: string): Promise<boolean> => {
        try {
            const accessList = await repository.findMany({organizationId});
            if (accessList.length === 0) return true;

            return accessList.some(entry => entry.email === email);
        } catch (error) {
            console.log(error);
            return false;
        }
    };

    isEnabled = async (organizationId: string): Promise<boolean> => {
        try {
            const accessList = await repository.findMany({organizationId});
            return accessList.length > 0;
        } catch (error) {
            console.log(error);
            return false;
        }
    };
}
