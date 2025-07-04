import fs from 'fs';
import path from 'path';

export class EmailTemplateUtil {
    private static templateCache: Map<string, string> = new Map();

    private static loadTemplate(templateName: string, type: 'html' | 'txt'): string {
        const cacheKey = `${templateName}.${type}`;

        if (this.templateCache.has(cacheKey)) {
            return this.templateCache.get(cacheKey)!;
        }

        const templatePath = path.join(__dirname, '..', 'templates', 'email', `${templateName}.${type}`);

        try {
            const template = fs.readFileSync(templatePath, 'utf-8');
            this.templateCache.set(cacheKey, template);
            return template;
        } catch (error) {
            throw new Error(`Failed to load email template: ${templatePath}`);
        }
    }

    private static replaceVariables(template: string, variables: Record<string, any>): string {
        let result = template;

        // Handle simple variable replacement {{variable}}
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            result = result.replace(regex, variables[key] || '');
        });

        // Handle conditional blocks {{#if variable}}...{{/if}}
        result = result.replace(/{{#if\s+(\w+)}}([\s\S]*?){{\/if}}/g, (match, variable, content) => {
            return variables[variable] ? content : '';
        });

        // Handle negative conditional blocks {{#unless variable}}...{{/unless}}
        result = result.replace(/{{#unless\s+(\w+)}}([\s\S]*?){{\/unless}}/g, (match, variable, content) => {
            return !variables[variable] ? content : '';
        });

        return result;
    }

    static renderTemplate(templateName: string, variables: Record<string, any>): {html: string; text: string} {
        const htmlTemplate = this.loadTemplate(templateName, 'html');
        const textTemplate = this.loadTemplate(templateName, 'txt');

        return {
            html: this.replaceVariables(htmlTemplate, variables),
            text: this.replaceVariables(textTemplate, variables),
        };
    }
}
