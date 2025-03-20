import axios from "axios";
import xml2js from "xml2js";

interface SamlIdpInfoResponse {
    entityID: string;
    singleSignOnServices: { binding: any; location: any; }[];
    singleLogoutServices: { binding: any; location: any; }[];
    certificate: string | null;
}

export class SamlService {
    static buildSamlStrategyName = (id: string) => `saml-${id}`;
    /**
     * Extracts key SAML IdP information from metadata XML
     * @param {string} metadataUrl - URL to the SAML metadata XML or XML string
     * @param {boolean} isXmlString - Whether the first parameter is an XML string instead of URL
     * @returns {Promise<SamlIdpInfoResponse>} Extracted SAML metadata information
     */
    static extractSamlIdpInfo = async (metadataUrl: string, isXmlString: boolean = false): Promise<SamlIdpInfoResponse> => {
        try {
            let xmlData;

            if (isXmlString) {
                xmlData = metadataUrl; // Use the provided XML string
            } else {
                // Fetch XML from URL
                const response = await axios.get(metadataUrl);
                xmlData = response.data;
            }

            // Parse XML to JavaScript object
            const parser = new xml2js.Parser({
                explicitArray: false,
                tagNameProcessors: [xml2js.processors.stripPrefix]
            });

            const result = await parser.parseStringPromise(xmlData);

            // Extract EntityDescriptor and entityID
            const entityDescriptor = result.EntityDescriptor;
            const entityID = entityDescriptor.$.entityID;

            // Extract IDPSSODescriptor
            const idpDescriptor = entityDescriptor.IDPSSODescriptor;
            if (!idpDescriptor) {
                throw new Error('No IDPSSODescriptor found in metadata');
            }

            // Extract SingleSignOnService endpoints
            const ssoServices: { binding: any; location: any; }[] = [];
            if (idpDescriptor.SingleSignOnService) {
                const services = Array.isArray(idpDescriptor.SingleSignOnService)
                    ? idpDescriptor.SingleSignOnService
                    : [idpDescriptor.SingleSignOnService];

                services.forEach((service: any) => {
                    ssoServices.push({
                        binding: service.$.Binding,
                        location: service.$.Location
                    });
                });
            }

            // Extract SingleLogoutService endpoints (if available)
            const sloServices: { binding: any; location: any; }[] = [];
            if (idpDescriptor.SingleLogoutService) {
                const logoutServices = Array.isArray(idpDescriptor.SingleLogoutService)
                    ? idpDescriptor.SingleLogoutService
                    : [idpDescriptor.SingleLogoutService];

                logoutServices.forEach((service: any) => {
                    sloServices.push({
                        binding: service.$.Binding,
                        location: service.$.Location
                    });
                });
            }

            // Extract X509Certificate (if available)
            let certificate = null;
            if (idpDescriptor.KeyDescriptor) {
                const keyDescriptors = Array.isArray(idpDescriptor.KeyDescriptor)
                    ? idpDescriptor.KeyDescriptor
                    : [idpDescriptor.KeyDescriptor];

                // Look for signing certificate
                for (const keyDesc of keyDescriptors) {
                    if (!keyDesc.$ || keyDesc.$.use === 'signing' || !keyDesc.$.use) {
                        if (keyDesc.KeyInfo && keyDesc.KeyInfo.X509Data && keyDesc.KeyInfo.X509Data.X509Certificate) {
                            certificate = keyDesc.KeyInfo.X509Data.X509Certificate;
                            break;
                        }
                    }
                }
            }

            return {
                entityID,
                singleSignOnServices: ssoServices,
                singleLogoutServices: sloServices,
                certificate
            };
        } catch (error) {
            console.error('Error extracting SAML IdP information:', error);
            throw error;
        }
    }
}
