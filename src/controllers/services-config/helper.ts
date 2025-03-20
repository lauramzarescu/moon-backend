import {ServicesConfig} from "@prisma/client";

export interface AWSConfig {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    accountId: string;
    canEdit?: boolean;
}

export class ServicesConfigHelper {
    static getAWSConfig(serviceConfig: ServicesConfig | null): AWSConfig | null {
        const config = serviceConfig?.config as unknown as AWSConfig;

        if (
            config &&
            config.accessKeyId &&
            config.secretAccessKey &&
            config.region &&
            config.accountId
        ) {
            return {
                accessKeyId: config.accessKeyId,
                secretAccessKey: this.maskSecretKey(config.secretAccessKey),
                region: config.region,
                accountId: config.accountId,
                canEdit: true
            };
        }

        if (
            process.env.AWS_ACCESS_KEY_ID &&
            process.env.AWS_SECRET_ACCESS_KEY &&
            process.env.AWS_REGION &&
            process.env.AWS_ACCOUNT_ID
        ) {
            return {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: this.maskSecretKey(process.env.AWS_SECRET_ACCESS_KEY),
                region: process.env.AWS_REGION,
                accountId: process.env.AWS_ACCOUNT_ID,
                canEdit: false
            };
        }

        return null;
    }

    private static maskSecretKey(secretKey: string): string {
        // Show only the first 4 and last 4 characters, mask the rest with asterisks
        if (secretKey.length <= 8) {
            return "********"; // If the key is too short, just mask it entirely
        }

        const firstFour = secretKey.substring(0, 4);
        const lastFour = secretKey.substring(secretKey.length - 4);
        const maskedLength = secretKey.length - 8;
        const maskedPart = "*".repeat(maskedLength);

        return `${firstFour}${maskedPart}${lastFour}`;
    }
}
