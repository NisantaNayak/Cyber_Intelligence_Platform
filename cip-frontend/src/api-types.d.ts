import * as _prisma_client_runtime_library_js from '@prisma/client/runtime/library.js';
import * as _trpc_server from '@trpc/server';

type AuthContext = {
    subject: string;
    /** RBAC data scope; "*" = unrestricted. Enforced in every query + cache key. */
    dataScope: string;
};

type Context = {
    auth: AuthContext | null;
};

declare const appRouter: _trpc_server.TRPCBuiltRouter<{
    ctx: Context;
    meta: object;
    errorShape: _trpc_server.TRPCDefaultErrorShape;
    transformer: true;
}, _trpc_server.TRPCDecorateCreateRouterOptions<{
    search: _trpc_server.TRPCBuiltRouter<{
        ctx: Context;
        meta: object;
        errorShape: _trpc_server.TRPCDefaultErrorShape;
        transformer: true;
    }, _trpc_server.TRPCDecorateCreateRouterOptions<{
        query: _trpc_server.TRPCQueryProcedure<{
            input: {
                q: string;
                perDomain?: number | undefined;
            };
            output: {
                query: string;
                domains: {
                    entityType: string;
                    count: number;
                    top: {
                        nodeId: string;
                        displayName: string;
                        rank: number;
                    }[];
                }[];
                total: number;
            };
            meta: object;
        }>;
    }>>;
    entity: _trpc_server.TRPCBuiltRouter<{
        ctx: Context;
        meta: object;
        errorShape: _trpc_server.TRPCDefaultErrorShape;
        transformer: true;
    }, _trpc_server.TRPCDecorateCreateRouterOptions<{
        get: _trpc_server.TRPCQueryProcedure<{
            input: {
                nodeId: string;
            };
            output: {
                node: {
                    nodeId: string;
                    entityType: string;
                    displayName: string;
                    criticality: number;
                };
                golden: {
                    assetId: string;
                    hostname: string | null;
                    ipAddress: string | null;
                    macAddress: string | null;
                    deviceType: string | null;
                    ownerDept: string | null;
                    exposure: string | null;
                    firstSeen: Date | null;
                    lastSeen: Date | null;
                } | {
                    userId: string;
                    email: string | null;
                    upn: string | null;
                    employeeType: string | null;
                    managerId: string | null;
                    mfaEnabled: boolean | null;
                } | {
                    vulnId: string;
                    cveId: string | null;
                    cvssBase: number | null;
                    severity: string | null;
                    exploitAvailable: boolean | null;
                    kev: boolean | null;
                } | null;
                sourceTabs: {
                    tab: any;
                    sourceSystem: string;
                    sourceNativeId: string;
                    loadedAt: Date;
                    raw: _prisma_client_runtime_library_js.JsonValue;
                }[];
                relationships: {
                    outgoing: {
                        edgeType: string;
                        count: number;
                    }[];
                    incoming: {
                        edgeType: string;
                        count: number;
                    }[];
                };
            };
            meta: object;
        }>;
    }>>;
    pivot: _trpc_server.TRPCBuiltRouter<{
        ctx: Context;
        meta: object;
        errorShape: _trpc_server.TRPCDefaultErrorShape;
        transformer: true;
    }, _trpc_server.TRPCDecorateCreateRouterOptions<{
        expand: _trpc_server.TRPCQueryProcedure<{
            input: {
                nodeId: string;
                depth?: number | undefined;
                edgeTypes?: string[] | undefined;
            };
            output: {
                root: string;
                depth: number;
                nodes: {
                    nodeId: string;
                    entityType: string;
                    displayName: string;
                    criticality: number;
                }[];
                edges: any[];
                summary: {
                    nodeCount: number;
                    edgeCount: number;
                    byType: Record<string, number>;
                };
            };
            meta: object;
        }>;
    }>>;
    stats: _trpc_server.TRPCBuiltRouter<{
        ctx: Context;
        meta: object;
        errorShape: _trpc_server.TRPCDefaultErrorShape;
        transformer: true;
    }, _trpc_server.TRPCDecorateCreateRouterOptions<{
        overview: _trpc_server.TRPCQueryProcedure<{
            input: void;
            output: {
                totals: Record<string, number>;
                assetsByType: {
                    type: any;
                    count: any;
                }[];
                vulnsBySeverity: {
                    severity: any;
                    count: any;
                    kev: any;
                }[];
                kevTotal: number;
                usersMfa: {
                    enabled: any;
                    disabled: any;
                };
                edges: any;
                sources: any;
            };
            meta: object;
        }>;
        assets: _trpc_server.TRPCQueryProcedure<{
            input: void;
            output: {
                total: any;
                vulnerable: any;
                incidentImpacted: any;
                clean: number;
                charts: {
                    byType: {
                        label: any;
                        value: any;
                    }[];
                    byExposure: {
                        label: any;
                        value: any;
                    }[];
                    byDept: {
                        label: any;
                        value: any;
                    }[];
                    bySourceCoverage: {
                        label: any;
                        value: any;
                    }[];
                };
            };
            meta: object;
        }>;
    }>>;
    asset: _trpc_server.TRPCBuiltRouter<{
        ctx: Context;
        meta: object;
        errorShape: _trpc_server.TRPCDefaultErrorShape;
        transformer: true;
    }, _trpc_server.TRPCDecorateCreateRouterOptions<{
        list: _trpc_server.TRPCQueryProcedure<{
            input: {
                deviceType?: string | undefined;
                ownerDept?: string | undefined;
                exposure?: string | undefined;
                sourceCount?: number | undefined;
                page?: number | undefined;
                pageSize?: number | undefined;
            };
            output: {
                total: number;
                page: number;
                pageSize: number;
                pages: number;
                rows: {
                    assetId: string;
                    hostname: string | null;
                    ip: string | null;
                    mac: string | null;
                    deviceType: string | null;
                    ownerDept: string;
                    exposure: string | null;
                    lastSeen: Date | null;
                    sourceCount: number;
                }[];
            };
            meta: object;
        }>;
    }>>;
    finding: _trpc_server.TRPCBuiltRouter<{
        ctx: Context;
        meta: object;
        errorShape: _trpc_server.TRPCDefaultErrorShape;
        transformer: true;
    }, _trpc_server.TRPCDecorateCreateRouterOptions<{
        list: _trpc_server.TRPCQueryProcedure<{
            input: {
                severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | undefined;
                ruleKey?: string | undefined;
                limit?: number | undefined;
            };
            output: {
                total: number;
                bySeverity: Record<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW", number>;
                items: {
                    firstSeen: string;
                    lastSeen: string;
                    findingId: string;
                    ruleKey: string;
                    severity: string;
                    title: string;
                    primaryNode: string;
                    primaryName: string | null;
                    primaryType: string | null;
                    relatedNodes: string[];
                    evidence: unknown;
                }[];
            };
            meta: object;
        }>;
    }>>;
}>>;
type AppRouter = typeof appRouter;

export type { AppRouter };
