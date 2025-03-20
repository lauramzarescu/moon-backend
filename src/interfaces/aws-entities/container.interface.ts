export interface ContainerInterface {
    image: string
    cpu: number
    memory: string
    name: string
    environmentVariables: {
        environment: Array<{ name: string; value: string }>
        environmentFiles: any[]
        secrets: any[]
    }
}
