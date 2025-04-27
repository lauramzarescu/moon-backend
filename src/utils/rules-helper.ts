/**
 * Utility class for handling port-related operations
 */
export class RulesHelper {
    /**
     * Parse a port range string into from and to port numbers
     * @param portRange The port range string (e.g., "80" or "80-443")
     * @returns An object containing fromPort and toPort
     */
    public static parsePortRange(portRange: string): {fromPort: number; toPort: number} {
        let fromPort: number;
        let toPort: number;

        if (portRange.includes('-')) {
            // It's a port range (e.g., "80-443")
            const [start, end] = portRange.split('-').map(p => parseInt(p.trim(), 10));
            fromPort = start;
            toPort = end;
        } else {
            // It's a single port (e.g., "22")
            fromPort = parseInt(portRange.trim(), 10);
            toPort = fromPort;
        }

        // Validate the ports
        if (isNaN(fromPort) || isNaN(toPort)) {
            throw new Error(`Invalid port range format: ${portRange}`);
        }

        if (fromPort < 1 || fromPort > 65535 || toPort < 1 || toPort > 65535) {
            throw new Error(`Port values must be between 1 and 65535. Got: ${portRange}`);
        }

        if (fromPort > toPort) {
            throw new Error(
                `Invalid port range: start port (${fromPort}) must be less than or equal to end port (${toPort})`
            );
        }

        return {fromPort, toPort};
    }

    /**
     * Ensures an IP address is in CIDR format
     * @param ip The IP address to format
     * @returns The IP address in CIDR format
     */
    public static ensureCidrFormat(ip: string): string {
        // If IP already has a CIDR suffix (contains '/'), return as is
        if (ip.includes('/')) {
            return ip;
        }

        // For IPv4 addresses, append /32 for single host
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
            return `${ip}/32`;
        }

        // For IPv6 addresses (simplified check)
        if (ip.includes(':')) {
            return `${ip}/128`;
        }

        // Return original if it doesn't match IP patterns
        // This might still cause errors but preserves original behavior
        return ip;
    }
}
