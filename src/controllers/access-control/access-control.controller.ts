import {Request, Response} from 'express';
import {AccessControlRepository} from '../../repositories/access-control/access-control.repository';
import {accessControlCreateSchema} from "./access-control.schema";
import {AuthService} from "../../services/auth.service"
import {UserRepository} from '../../repositories/user/user.repository';
import {prisma} from "../../config/db.config";

export class AccessControlController {
    protected repository = new AccessControlRepository(prisma);
    protected userRepository = new UserRepository(prisma);

    addToList = async (req: Request, res: Response) => {
        try {
            const {email, description} = req.body;
            const token = AuthService.decodeToken(req.headers.authorization);
            console.log(token.userId)
            const user = await this.userRepository.getOneWhere({id: token.userId});

            const validatedData = accessControlCreateSchema.parse({email, description});
            const result = await this.repository.create({
                ...validatedData,
                organizationId: user.organizationId,
                isAllowed: true
            });

            res.status(201).json(result);
        } catch (error) {
            console.log(error)
            res.status(500).json({message: "Internal server error"})
        }
    }

    disableAccessControl = async (req: Request, res: Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOneWhere({id: token.userId});

            const result = await this.repository.deleteMany({
                organizationId: user.organizationId
            });

            res.status(200).json({
                message: "Access control disabled successfully",
                deletedCount: result.count
            });
        } catch (error) {
            console.log(error)
            res.status(500).json({message: "Internal server error"})
        }
    }

    removeFromList = async (req: Request, res: Response) => {
        try {
            const {id} = req.params;
            const result = await this.repository.delete(id);

            res.status(200).json(result);
        } catch (error) {
            console.log(error)
            res.status(500).json({message: "Internal server error"})
        }
    }

    getList = async (req: Request, res: Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOneWhere({id: token.userId});
            const result = await this.repository.findMany({organizationId: user.organizationId});

            res.status(200).json(result);
        } catch (error) {
            console.log(error)
            res.status(500).json({message: "Internal server error"})
        }
    }
}
