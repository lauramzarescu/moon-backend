/**
 * Variable comparison status for version comparisons
 */
export enum ComparisonStatus {
    ADDED = 'added',
    REMOVED = 'removed',
    MODIFIED = 'modified',
    UNCHANGED = 'unchanged',
}

/**
 * Bulk operation types for environment variable operations
 */
export enum BulkOperationType {
    ADD = 'add',
    EDIT = 'edit',
    REPLACE = 'replace',
    REMOVE = 'remove',
}
