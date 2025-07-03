import {z} from 'zod';

export const organizationSchema = z.object({
    name: z.string().min(1, 'Organization name is required'),
    enforce2FA: z.boolean(),
});

export const organizationUpdateSchema = z.object({
    enforce2FA: z.boolean(),
});

export const organizationDetailsResponseSchema = z.object({
    id: z.string(),
    name: z.string(),
    enforce2FA: z.boolean(),
    createdAt: z.date().transform(date => date.toISOString()),
    updatedAt: z.date().transform(date => date.toISOString()),
});

export type OrganizationInput = z.infer<typeof organizationSchema>;
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;

export interface OrganizationDetailsResponse {
    id: string;
    name: string;
    enforce2FA: boolean;
    createdAt: string;
    updatedAt: string;
}
