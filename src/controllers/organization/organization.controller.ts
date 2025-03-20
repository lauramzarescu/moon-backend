import express from 'express';
import {OrganizationRepository} from "../../repositories/organization/organization.repository";
import {prisma} from "../../config/db.config";

export class OrganizationController {
    static organizationRepository = new OrganizationRepository(prisma);

    static getAll = async (req: express.Request, res: express.Response) => {
        try {
            const organizations = await this.organizationRepository.getAll();
            res.json(organizations);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static getOne = async (req: express.Request, res: express.Response) => {
        try {
            const organization = await this.organizationRepository.getOne(req.params.id);
            res.json(organization);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static create = async (req: express.Request, res: express.Response) => {
        try {
            const organization = await this.organizationRepository.create(req.body);
            res.status(201).json(organization);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static update = async (req: express.Request, res: express.Response) => {
        try {
            const organization = await this.organizationRepository.update(req.params.id, req.body);
            res.json(organization);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static delete = async (req: express.Request, res: express.Response) => {
        try {
            const organization = await this.organizationRepository.delete(req.params.id);
            res.json(organization);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }
}
