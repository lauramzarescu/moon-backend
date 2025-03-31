export const backoffAndRetry = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            if (
                (error.message?.toLowerCase().includes('exceeded') ||
                    error.message?.toLowerCase().includes('throttling')) &&
                i < maxRetries - 1
            ) {
                const delay = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
    throw new Error('Max retries reached');
};
