# FlowOps API Reference

This is a JSON-formatted reference for the routes currently registered by the server. Values are fictional examples; IDs, timestamps, counts, and records vary with the database. The frontend uses the configured API base URL and authenticated session cookie for supported workspace features. Billing, integrations, and file uploads are not available.

```json
{
  "baseUrl": "http://localhost:4000",
  "apiPrefix": "/api/v1",
  "conventions": {
    "contentType": "application/json",
    "sessionCookie": "flowops_session",
    "organizationSelection": {
      "header": "x-organization-id",
      "example": "org_demo_001",
      "default": "The first organization the signed-in user belongs to"
    },
    "pagination": {
      "query": {
        "page": 1,
        "pageSize": 50
      },
      "maximumPageSize": 100
    },
    "noContentResponse": {
      "status": 204,
      "body": null
    },
    "commonErrorResponse": {
      "error": {
        "code": "VALIDATION_ERROR",
        "message": "The request contains invalid data.",
        "details": []
      }
    }
  },
  "endpoints": [
    {
      "group": "Health",
      "routes": [
        {
          "method": "GET",
          "path": "/health",
          "auth": "Public",
          "request": { "pathParams": {}, "query": {}, "body": null },
          "responses": {
            "200": {
              "status": "ok",
              "service": "flowops-api",
              "mode": "demo"
            }
          }
        },
        {
          "method": "GET",
          "path": "/health/db",
          "auth": "Public",
          "request": { "pathParams": {}, "query": {}, "body": null },
          "responses": {
            "200": { "status": "ok", "database": "connected" },
            "503": { "status": "error", "database": "unavailable" }
          }
        }
      ]
    },
    {
      "group": "Authentication and profile",
      "routes": [
        {
          "method": "POST",
          "path": "/api/v1/auth/login",
          "auth": "Public",
          "request": {
            "pathParams": {},
            "query": {},
            "body": {
              "email": "team@flowops.example",
              "password": "password123",
              "rememberMe": true
            }
          },
          "responses": {
            "200": {
              "user": {
                "id": "usr_demo_001",
                "email": "team@flowops.example",
                "name": "Ariana Patel",
                "organization": {
                  "id": "org_demo_001",
                  "name": "FlowOps Workspace",
                  "role": "Owner"
                }
              }
            },
            "401": {
              "error": {
                "code": "INVALID_CREDENTIALS",
                "message": "The email or password is incorrect."
              }
            }
          },
          "setsCookie": "flowops_session"
        },
        {
          "method": "POST",
          "path": "/api/v1/auth/logout",
          "auth": "Public; sends the session cookie if available",
          "request": { "pathParams": {}, "query": {}, "body": null },
          "responses": { "204": null },
          "effects": ["Revokes the matching session", "Clears the session cookie"]
        },
        {
          "method": "GET",
          "path": "/api/v1/auth/me",
          "auth": "Signed in",
          "request": { "pathParams": {}, "query": {}, "body": null },
          "responses": {
            "200": {
              "user": {
                "id": "usr_demo_001",
                "email": "team@flowops.example",
                "name": "Ariana Patel",
                "organization": {
                  "id": "org_demo_001",
                  "name": "FlowOps Workspace",
                  "role": "Owner"
                }
              }
            }
          }
        },
        {
          "method": "PATCH",
          "path": "/api/v1/auth/me",
          "auth": "Signed in",
          "request": {
            "pathParams": {},
            "query": {},
            "body": {
              "name": "Ariana Patel",
              "timezone": "America/Los_Angeles",
              "preferences": { "theme": "dark" }
            }
          },
          "responses": {
            "200": {
              "user": {
                "id": "usr_demo_001",
                "email": "team@flowops.example",
                "name": "Ariana Patel",
                "timezone": "America/Los_Angeles",
                "preferences": { "theme": "dark" }
              }
            }
          },
          "constraints": ["Provide at least one field to update"]
        },
        {
          "method": "GET",
          "path": "/api/v1/organizations",
          "auth": "Signed in",
          "request": { "pathParams": {}, "query": {}, "body": null },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "org_demo_001",
                  "name": "FlowOps Workspace",
                  "role": "Owner"
                }
              ]
            }
          }
        }
      ]
    },
    {
      "group": "Password recovery",
      "configuration": {
        "emailProvider": "Resend",
        "requiredEnvironmentVariables": ["RESEND_API_KEY", "EMAIL_FROM"],
        "senderFallback": "FlowOps <onboarding@resend.dev>",
        "senderDomainMustBeVerified": true
      },
      "roleFlow": {
        "VIEWER/MEMBER/MANAGER": "Create a request for an organization owner or admin.",
        "ADMIN": "Create a request for an organization owner.",
        "OWNER": "Create a request for another organization owner or admin."
      },
      "policy": {
        "selfService": false,
        "description": "There is no email code or self-service reset. An owner or admin sets the new temporary password from the admin console, which revokes all of the requester's sessions."
      },
      "routes": [
        {
          "method": "POST",
          "path": "/api/v1/auth/password/forgot",
          "auth": "Public",
          "request": {
            "pathParams": {},
            "query": {},
            "body": {
              "email": "member@example.test",
              "organizationId": "org_demo_001"
            }
          },
          "responses": {
            "202": {
              "message": "Your password reset request has been sent to an administrator or owner of your organization. They will set a new password for you manually."
            },
            "503": {
              "error": {
                "code": "RECOVERY_NOT_CONFIGURED",
                "message": "Password recovery email is not configured."
              }
            },
            "503_EMAIL_DELIVERY_FAILED": {
              "error": {
                "code": "EMAIL_DELIVERY_FAILED",
                "message": "The recovery email could not be delivered."
              }
            },
            "409": {
              "error": {
                "code": "NO_APPROVER",
                "message": "No eligible administrator is configured for this organization."
              }
            }
          }
        },
        {
          "method": "GET",
          "path": "/api/v1/auth/password/requests",
          "auth": "Organization owner or admin",
          "request": {
            "pathParams": {},
            "query": { "organizationId": "org_demo_001" },
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "recovery_demo_001",
                  "requester": {
                    "id": "usr_member_001",
                    "email": "member@example.test",
                    "name": "Morgan Member"
                  },
                  "requesterRole": "MEMBER",
                  "organizationId": "org_demo_001",
                  "createdAt": "2026-10-03T12:00:00.000Z",
                  "expiresAt": "2026-10-10T12:00:00.000Z"
                }
              ]
            }
          }
        },
        {
          "method": "POST",
          "path": "/api/v1/auth/password/requests/:requestId/complete",
          "auth": "Eligible organization owner or admin",
          "notes": "A reviewer cannot complete their own request.",
          "request": {
            "pathParams": { "requestId": "recovery_demo_001" },
            "query": { "organizationId": "org_demo_001" },
            "body": { "newPassword": "Example-New-Password-2026" }
          },
          "responses": {
            "200": {
              "message": "Password changed and existing sessions revoked."
            },
            "403": {
              "error": {
                "code": "FORBIDDEN",
                "message": "You cannot reset your own password through a recovery request."
              }
            }
          }
        }
      ]
    },
    {
      "group": "Custom roles and permissions",
      "permissionKeys": [
        { "id": "PROJECT_READ", "label": "View projects" },
        { "id": "PROJECT_WRITE", "label": "Manage projects" },
        { "id": "TASK_READ", "label": "View tasks" },
        { "id": "TASK_WRITE", "label": "Manage tasks" },
        { "id": "MEMBER_READ", "label": "View team members" },
        { "id": "MEMBER_MANAGE", "label": "Manage team members" },
        { "id": "ROLE_MANAGE", "label": "Manage roles and permissions" },
        { "id": "ANALYTICS_READ", "label": "View analytics" },
        { "id": "AUDIT_READ", "label": "View audit logs and activity" },
        { "id": "NOTIFICATION_READ", "label": "View notifications" },
        { "id": "NOTIFICATION_MANAGE", "label": "Manage notifications" },
        { "id": "COMMENT_MODERATE", "label": "Moderate other members' comments" }
      ],
      "routes": [
        {
          "method": "GET",
          "path": "/api/v1/organizations/:organizationId/roles/permissions",
          "auth": "Organization owner/admin or member with MEMBER_MANAGE",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                { "id": "PROJECT_READ", "label": "View projects" },
                { "id": "PROJECT_WRITE", "label": "Manage projects" },
                { "id": "TASK_READ", "label": "View tasks" },
                { "id": "TASK_WRITE", "label": "Manage tasks" },
                { "id": "MEMBER_READ", "label": "View team members" },
                { "id": "MEMBER_MANAGE", "label": "Manage team members" },
                { "id": "ROLE_MANAGE", "label": "Manage roles and permissions" },
                { "id": "ANALYTICS_READ", "label": "View analytics" },
                { "id": "AUDIT_READ", "label": "View audit logs and activity" },
                { "id": "NOTIFICATION_READ", "label": "View notifications" },
                { "id": "NOTIFICATION_MANAGE", "label": "Manage notifications" },
                { "id": "COMMENT_MODERATE", "label": "Moderate other members' comments" }
              ]
            }
          }
        },
        {
          "method": "GET",
          "path": "/api/v1/organizations/:organizationId/roles",
          "auth": "Organization owner/admin or member with MEMBER_MANAGE",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "OWNER",
                  "name": "Owner",
                  "description": "",
                  "builtIn": true,
                  "memberCount": 1,
                  "permissions": [
                    "PROJECT_READ",
                    "PROJECT_WRITE",
                    "TASK_READ",
                    "TASK_WRITE",
                    "MEMBER_READ",
                    "MEMBER_MANAGE",
                    "ROLE_MANAGE",
                    "ANALYTICS_READ",
                    "AUDIT_READ",
                    "NOTIFICATION_READ",
                    "NOTIFICATION_MANAGE",
                    "COMMENT_MODERATE"
                  ]
                },
                {
                  "id": "ADMIN",
                  "name": "Admin",
                  "description": "",
                  "builtIn": true,
                  "memberCount": 1,
                  "permissions": [
                    "PROJECT_READ",
                    "PROJECT_WRITE",
                    "TASK_READ",
                    "TASK_WRITE",
                    "MEMBER_READ",
                    "MEMBER_MANAGE",
                    "ROLE_MANAGE",
                    "ANALYTICS_READ",
                    "AUDIT_READ",
                    "NOTIFICATION_READ",
                    "NOTIFICATION_MANAGE",
                    "COMMENT_MODERATE"
                  ]
                },
                {
                  "id": "MANAGER",
                  "name": "Manager",
                  "description": "",
                  "builtIn": true,
                  "memberCount": 0,
                  "permissions": [
                    "PROJECT_READ",
                    "PROJECT_WRITE",
                    "TASK_READ",
                    "TASK_WRITE",
                    "MEMBER_READ",
                    "ANALYTICS_READ",
                    "AUDIT_READ",
                    "NOTIFICATION_READ",
                    "NOTIFICATION_MANAGE"
                  ]
                },
                {
                  "id": "MEMBER",
                  "name": "Member",
                  "description": "",
                  "builtIn": true,
                  "memberCount": 0,
                  "permissions": [
                    "PROJECT_READ",
                    "PROJECT_WRITE",
                    "TASK_READ",
                    "TASK_WRITE",
                    "MEMBER_READ",
                    "ANALYTICS_READ",
                    "AUDIT_READ",
                    "NOTIFICATION_READ",
                    "NOTIFICATION_MANAGE"
                  ]
                },
                {
                  "id": "VIEWER",
                  "name": "Viewer",
                  "description": "",
                  "builtIn": true,
                  "memberCount": 0,
                  "permissions": [
                    "PROJECT_READ",
                    "TASK_READ",
                    "MEMBER_READ",
                    "ANALYTICS_READ",
                    "AUDIT_READ",
                    "NOTIFICATION_READ",
                    "NOTIFICATION_MANAGE"
                  ]
                },
                {
                  "id": "custom_role_demo_001",
                  "name": "Finance Lead",
                  "description": "Read analytics and manage assigned projects.",
                  "builtIn": false,
                  "memberCount": 3,
                  "permissions": ["PROJECT_READ", "PROJECT_WRITE", "ANALYTICS_READ"],
                  "createdAt": "2026-10-04T10:00:00.000Z",
                  "updatedAt": "2026-10-04T10:00:00.000Z"
                }
              ]
            }
          }
        },
        {
          "method": "POST",
          "path": "/api/v1/organizations/:organizationId/roles",
          "auth": "Organization owner/admin, or custom role with ROLE_MANAGE",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {},
            "body": {
              "name": "Finance Lead",
              "description": "Read analytics and manage assigned projects.",
              "permissions": ["PROJECT_READ", "PROJECT_WRITE", "ANALYTICS_READ"]
            }
          },
          "responses": {
            "201": {
              "data": {
                "id": "custom_role_demo_001",
                "name": "Finance Lead",
                "description": "Read analytics and manage assigned projects.",
                "builtIn": false,
                "memberCount": 0,
                "permissions": ["PROJECT_READ", "PROJECT_WRITE", "ANALYTICS_READ"],
                "createdAt": "2026-10-04T10:00:00.000Z",
                "updatedAt": "2026-10-04T10:00:00.000Z"
              }
            },
            "400": {
              "error": {
                "code": "VALIDATION_ERROR",
                "message": "The request contains invalid data.",
                "details": []
              }
            },
            "409": {
              "error": {
                "code": "ROLE_NAME_ALREADY_EXISTS",
                "message": "A custom role with this name already exists."
              }
            }
          },
          "constraints": {
            "nameLength": "2 to 60 characters",
            "descriptionLength": "At most 500 characters",
            "permissions": "Unique values from permissionKeys",
            "builtInRoles": "Cannot be edited or deleted",
            "customRoleManagement": "Custom ROLE_MANAGE users may only grant permissions they possess"
          }
        },
        {
          "method": "PATCH",
          "path": "/api/v1/organizations/:organizationId/roles/:roleId",
          "auth": "Organization owner/admin, or custom role with ROLE_MANAGE",
          "request": {
            "pathParams": {
              "organizationId": "org_demo_001",
              "roleId": "custom_role_demo_001"
            },
            "query": {},
            "body": { "permissions": ["PROJECT_READ", "ANALYTICS_READ", "AUDIT_READ"] }
          },
          "responses": {
            "200": {
              "data": {
                "id": "custom_role_demo_001",
                "name": "Finance Lead",
                "description": "Read analytics and manage assigned projects.",
                "builtIn": false,
                "permissions": ["PROJECT_READ", "ANALYTICS_READ", "AUDIT_READ"],
                "updatedAt": "2026-10-04T10:10:00.000Z"
              }
            },
            "404": {
              "error": {
                "code": "CUSTOM_ROLE_NOT_FOUND",
                "message": "Custom role not found."
              }
            }
          }
        },
        {
          "method": "DELETE",
          "path": "/api/v1/organizations/:organizationId/roles/:roleId",
          "auth": "Organization owner/admin, or custom role with ROLE_MANAGE",
          "request": {
            "pathParams": {
              "organizationId": "org_demo_001",
              "roleId": "custom_role_demo_001"
            },
            "query": {},
            "body": null
          },
          "responses": {
            "204": null,
            "409": {
              "error": {
                "code": "CUSTOM_ROLE_IN_USE",
                "message": "Reassign members before deleting this role."
              }
            }
          }
        },
        {
          "method": "PATCH",
          "path": "/api/v1/organizations/:organizationId/members/:memberId",
          "auth": "Organization owner/admin or member with MEMBER_MANAGE",
          "request": {
            "pathParams": {
              "organizationId": "org_demo_001",
              "memberId": "mem_demo_002"
            },
            "query": {},
            "body": { "customRoleId": "custom_role_demo_001" }
          },
          "responses": {
            "200": {
              "data": {
                "id": "mem_demo_002",
                "role": "MEMBER",
                "roleLabel": "Finance Lead",
                "customRole": {
                  "id": "custom_role_demo_001",
                  "name": "Finance Lead"
                }
              }
            },
            "404": {
              "error": {
                "code": "CUSTOM_ROLE_NOT_FOUND",
                "message": "Custom role not found in this organization."
              }
            }
          },
          "note": "Send { \"customRoleId\": null } to clear a custom role. Assigning a built-in role clears the custom role. Custom roles cannot replace OWNER or ADMIN. Only built-in owners/admins may grant ADMIN; only owners may grant OWNER. Delegated managers may assign only built-in roles whose permissions they hold."
        }
      ]
    },
    {
      "group": "Organizations and membership",
      "routes": [
        {
          "method": "GET",
          "path": "/api/v1/organizations/:organizationId",
          "auth": "Organization owner/admin or member with MEMBER_READ",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": {
                "id": "org_demo_001",
                "name": "FlowOps Workspace",
                "slug": "flowops-demo",
                "role": "Owner",
                "createdAt": "2026-10-01T12:00:00.000Z"
              }
            }
          }
        },
        {
          "method": "POST",
          "path": "/api/v1/organizations",
          "auth": "Signed in",
          "request": {
            "pathParams": {},
            "query": {},
            "body": { "name": "Design Workspace" }
          },
          "responses": {
            "201": {
              "data": {
                "id": "org_demo_002",
                "name": "Design Workspace",
                "slug": "design-workspace-a1b2c3d4",
                "createdAt": "2026-10-03T12:00:00.000Z",
                "role": "Owner"
              }
            }
          }
        },
        {
          "method": "PATCH",
          "path": "/api/v1/organizations/:organizationId",
          "auth": "Organization owner or admin",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {},
            "body": { "name": "FlowOps Product Workspace" }
          },
          "responses": {
            "200": {
              "data": {
                "id": "org_demo_001",
                "name": "FlowOps Product Workspace",
                "slug": "flowops-demo",
                "updatedAt": "2026-10-03T12:00:00.000Z"
              }
            }
          }
        },
        {
          "method": "GET",
          "paths": [
            "/api/v1/organizations/:organizationId/members",
            "/api/v1/members"
          ],
          "auth": "Organization member",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": { "page": 1, "pageSize": 50 },
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "mem_demo_001",
                  "user": {
                    "id": "usr_demo_001",
                    "name": "Ariana Patel",
                    "email": "team@flowops.example",
                    "timezone": "America/Los_Angeles",
                    "createdAt": "2026-10-01T12:00:00.000Z"
                  },
                  "role": "OWNER",
                  "roleLabel": "Owner",
                  "joinedAt": "2026-10-01T12:00:00.000Z"
                }
              ],
              "meta": {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "pageCount": 1
              }
            }
          }
        },
        {
          "method": "POST",
          "paths": [
            "/api/v1/organizations/:organizationId/members",
            "/api/v1/members"
          ],
          "auth": "Organization owner/admin or member with MEMBER_MANAGE",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {},
            "body": {
              "email": "existing@example.test",
              "role": "MEMBER"
            }
          },
          "responses": {
            "201": {
              "data": {
                "id": "mem_demo_002",
                "user": {
                  "id": "usr_demo_002",
                  "name": "Taylor Viewer",
                  "email": "existing@example.test"
                },
                "role": "MEMBER",
                "roleLabel": "Member"
              }
            }
          },
          "constraints": {
            "adminRole": "Only built-in owners/admins may grant ADMIN",
            "ownerRole": "Only built-in owners may grant OWNER",
            "builtInRolePermissions": "Delegated managers may assign only built-in roles whose permissions they hold"
          }
        },
        {
          "method": "POST",
          "path": "/api/v1/organizations/:organizationId/users",
          "auth": "Built-in organization owner or admin",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {},
            "body": {
              "name": "Taylor Member",
              "email": "taylor@example.test",
              "password": "Initial-Password-2026",
              "role": "MANAGER",
              "customRoleId": "optional_custom_role_id"
            }
          },
          "responses": {
            "201": {
              "data": {
                "id": "usr_demo_003",
                "name": "Taylor Member",
                "email": "taylor@example.test",
                "createdAt": "2026-10-03T12:00:00.000Z",
                "membership": {
                  "id": "mem_demo_003",
                  "role": "MEMBER",
                  "roleLabel": "Member"
                }
              }
            }
          },
          "constraints": {
            "password": "12 to 128 characters",
            "role": "OWNER, ADMIN, MANAGER, MEMBER, or VIEWER; defaults to MEMBER",
            "ownerRole": "Only owners may assign OWNER",
            "adminRole": "Only owners/admins may assign ADMIN",
            "customRoleId": "Optional custom role in the same organization; cannot be combined with OWNER or ADMIN"
          },
          "errors": {
            "400": "VALIDATION_ERROR or BUILT_IN_CUSTOM_ROLE_NOT_ALLOWED",
            "401": "UNAUTHENTICATED",
            "403": "FORBIDDEN",
            "404": "CUSTOM_ROLE_NOT_FOUND",
            "409": "EMAIL_ALREADY_REGISTERED"
          }
        },
        {
          "method": "PATCH",
          "paths": [
            "/api/v1/organizations/:organizationId/members/:memberId",
            "/api/v1/members/:memberId"
          ],
          "auth": "Organization owner/admin or member with MEMBER_MANAGE",
          "request": {
            "pathParams": {
              "organizationId": "org_demo_001",
              "memberId": "mem_demo_002"
            },
            "query": {},
            "body": { "role": "MANAGER" }
          },
          "responses": {
            "200": {
              "data": {
                "id": "mem_demo_002",
                "role": "MANAGER",
                "roleLabel": "Manager"
              }
            }
          }
        },
        {
          "method": "DELETE",
          "paths": [
            "/api/v1/organizations/:organizationId/members/:memberId",
            "/api/v1/members/:memberId"
          ],
          "auth": "Organization owner/admin or member with MEMBER_MANAGE",
          "request": {
            "pathParams": {
              "organizationId": "org_demo_001",
              "memberId": "mem_demo_002"
            },
            "query": {},
            "body": null
          },
          "responses": { "204": null },
          "constraints": ["Cannot remove yourself or an owner"]
        }
      ],
      "roles": ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"],
      "roleConstraints": [
        "Only an owner may grant the OWNER role.",
        "Creating an account with a registered email returns 409 EMAIL_ALREADY_REGISTERED.",
        "Adding an existing account returns 404 if not found or 409 ALREADY_MEMBER if already in the organization."
      ]
    },
    {
      "group": "Projects",
      "organizationRouteRule": "Each short route has an organization-scoped alias: /api/v1/organizations/:organizationId/projects and the same remaining path.",
      "routes": [
        {
          "method": "GET",
          "path": "/api/v1/projects",
          "auth": "Organization owner/admin or member with MEMBER_READ",
          "request": {
            "pathParams": {},
            "query": {
              "page": 1,
              "pageSize": 50,
              "search": "Northstar",
              "status": "On track",
              "ownerId": "usr_demo_001",
              "sort": "createdAt",
              "order": "desc",
              "includeArchived": false
            },
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "northstar-expansion",
                  "name": "Northstar Expansion",
                  "description": "",
                  "owner": "Ava Patel",
                  "ownerId": "usr_demo_001",
                  "status": "On track",
                  "progress": 82,
                  "value": "$145K",
                  "valueAmount": 145000,
                  "currency": "USD",
                  "startDate": null,
                  "dueDate": null,
                  "archivedAt": null,
                  "createdAt": "2026-10-01T12:00:00.000Z",
                  "updatedAt": "2026-10-03T12:00:00.000Z"
                }
              ],
              "meta": {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "pageCount": 1
              }
            }
          }
        },
        {
          "method": "POST",
          "path": "/api/v1/projects",
          "auth": "Organization owner, admin, or manager",
          "request": {
            "pathParams": {},
            "query": {},
            "body": {
              "name": "Website Refresh",
              "description": "Refresh public site",
              "status": "On track",
              "progress": 0,
              "valueAmount": 25000,
              "currency": "USD",
              "ownerId": "usr_demo_001",
              "startDate": "2026-10-03T00:00:00.000Z",
              "dueDate": null
            }
          },
          "responses": {
            "201": {
              "data": {
                "id": "project_demo_001",
                "name": "Website Refresh",
                "description": "Refresh public site",
                "owner": "Ariana Patel",
                "status": "On track",
                "progress": 0,
                "value": "$25K",
                "valueAmount": 25000,
                "currency": "USD"
              }
            }
          }
        },
        {
          "method": "GET",
          "path": "/api/v1/projects/:projectId",
          "auth": "Organization member",
          "request": {
            "pathParams": { "projectId": "northstar-expansion" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": {
                "id": "northstar-expansion",
                "name": "Northstar Expansion",
                "status": "On track",
                "progress": 82,
                "milestones": [],
                "deliverables": [],
                "risks": []
              }
            }
          }
        },
        {
          "method": "PATCH",
          "path": "/api/v1/projects/:projectId",
          "auth": "Organization owner, admin, or manager",
          "request": {
            "pathParams": { "projectId": "northstar-expansion" },
            "query": {},
            "body": { "status": "At risk", "progress": 82 }
          },
          "responses": {
            "200": {
              "data": {
                "id": "northstar-expansion",
                "status": "At risk",
                "progress": 82
              }
            }
          },
          "note": "The API returns the full project representation."
        },
        {
          "method": "POST",
          "path": "/api/v1/projects/:projectId/archive",
          "auth": "Organization owner, admin, or manager",
          "request": {
            "pathParams": { "projectId": "northstar-expansion" },
            "query": {},
            "body": null
          },
          "responses": { "204": null },
          "effects": ["Archived projects are hidden from regular lists"]
        },
        {
          "method": "DELETE",
          "path": "/api/v1/projects/:projectId",
          "auth": "Organization owner or admin",
          "request": {
            "pathParams": { "projectId": "northstar-expansion" },
            "query": {},
            "body": null
          },
          "responses": { "204": null }
        },
        {
          "resourceRoutes": [
            "/api/v1/projects/:projectId/milestones",
            "/api/v1/projects/:projectId/deliverables",
            "/api/v1/projects/:projectId/risks"
          ],
          "organizationScopedForm": "/api/v1/organizations/:organizationId/projects/:projectId/{milestones|deliverables|risks}",
          "auth": "Organization member for GET; organization owner, admin, or manager for writes",
          "methods": {
            "GET": {
              "request": {
                "pathParams": { "projectId": "northstar-expansion" },
                "query": {},
                "body": null
              },
              "response": {
                "200": {
                  "data": [
                    {
                      "id": "mile_demo_001",
                      "title": "Design review",
                      "label": "Design review",
                      "dueDate": "2026-10-15T00:00:00.000Z",
                      "sortOrder": 1,
                      "completed": false,
                      "done": false
                    }
                  ]
                }
              }
            },
            "POST": {
              "requestExamples": [
                {
                  "resource": "milestones",
                  "body": {
                    "title": "Design review",
                    "dueDate": "2026-10-15T00:00:00.000Z",
                    "sortOrder": 1,
                    "completed": false
                  }
                },
                {
                  "resource": "deliverables",
                  "body": {
                    "title": "Prototype",
                    "description": "Interactive draft",
                    "completed": false
                  }
                },
                {
                  "resource": "risks",
                  "body": {
                    "title": "Vendor delay",
                    "description": "Delivery date unconfirmed",
                    "resolved": false
                  }
                }
              ],
              "responseExamples": [
                {
                  "resource": "milestones",
                  "status": 201,
                  "body": {
                    "data": {
                      "id": "mile_demo_001",
                      "title": "Design review",
                      "label": "Design review",
                      "dueDate": "2026-10-15T00:00:00.000Z",
                      "sortOrder": 1,
                      "completed": false,
                      "done": false
                    }
                  }
                },
                {
                  "resource": "deliverables",
                  "status": 201,
                  "body": {
                    "data": {
                      "id": "deliverable_demo_001",
                      "title": "Prototype",
                      "description": "Interactive draft",
                      "completed": false
                    }
                  }
                },
                {
                  "resource": "risks",
                  "status": 201,
                  "body": {
                    "data": {
                      "id": "risk_demo_001",
                      "title": "Vendor delay",
                      "description": "Delivery date unconfirmed",
                      "resolved": false
                    }
                  }
                }
              ]
            },
            "PATCH": {
              "request": {
                "pathParams": {
                  "projectId": "northstar-expansion",
                  "itemId": "mile_demo_001"
                },
                "query": {},
                "body": { "completed": true }
              },
              "response": {
                "200": {
                  "data": {
                    "id": "mile_demo_001",
                    "completed": true,
                    "done": true
                  }
                }
              }
            },
            "DELETE": {
              "request": {
                "pathParams": {
                  "projectId": "northstar-expansion",
                  "itemId": "mile_demo_001"
                },
                "query": {},
                "body": null
              },
              "response": { "204": null }
            }
          },
          "itemRouteSuffix": "/:itemId"
        }
      ],
      "statuses": ["On track", "At risk", "Review", "Done"]
    },
    {
      "group": "Tasks and comments",
      "organizationRouteRule": "Each short route has an organization-scoped alias under /api/v1/organizations/:organizationId.",
      "routes": [
        {
          "method": "GET",
          "path": "/api/v1/tasks",
          "auth": "Organization member",
          "request": {
            "pathParams": {},
            "query": {
              "page": 1,
              "pageSize": 50,
              "search": "launch",
              "status": "In review",
              "priority": "High",
              "assigneeId": "usr_demo_001",
              "projectId": "northstar-expansion",
              "sort": "createdAt",
              "order": "desc",
              "includeArchived": false
            },
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "task_demo_001",
                  "title": "Launch checklist review",
                  "assignee": "Ava",
                  "assigneeId": "usr_demo_001",
                  "priority": "High",
                  "status": "In review",
                  "progress": 76,
                  "due": "2026-10-03",
                  "dueDate": "2026-10-03T12:00:00.000Z",
                  "stage": "Ready for sign-off",
                  "notes": "Confirm final sign-off.",
                  "projectId": "northstar-expansion",
                  "createdAt": "2026-10-01T12:00:00.000Z",
                  "updatedAt": "2026-10-03T12:00:00.000Z",
                  "completedAt": null
                }
              ],
              "meta": {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "pageCount": 1
              }
            }
          }
        },
        {
          "method": "GET",
          "path": "/api/v1/tasks/summary",
          "auth": "Organization member",
          "request": { "pathParams": {}, "query": {}, "body": null },
          "responses": {
            "200": {
              "data": {
                "total": 4,
                "open": 3,
                "completed": 1,
                "dueToday": 1,
                "byStatus": {
                  "Queued": 1,
                  "In review": 1,
                  "Blocked": 1,
                  "Done": 1
                },
                "byPriority": { "High": 2, "Medium": 1, "Low": 1 }
              }
            }
          }
        },
        {
          "method": "POST",
          "path": "/api/v1/tasks",
          "auth": "Organization owner, admin, or manager",
          "request": {
            "pathParams": {},
            "query": {},
            "body": {
              "title": "Prepare launch brief",
              "assignee": "Ava",
              "priority": "High",
              "status": "Queued",
              "progress": 0,
              "due": "Tomorrow",
              "stage": "Not started",
              "notes": "Draft the launch brief.",
              "projectId": "northstar-expansion"
            }
          },
          "responses": {
            "201": {
              "data": {
                "id": "task_demo_002",
                "title": "Prepare launch brief",
                "assignee": "Ava",
                "priority": "High",
                "status": "Queued",
                "progress": 0,
                "due": "2026-10-04",
                "stage": "Not started",
                "notes": "Draft the launch brief.",
                "projectId": "northstar-expansion"
              }
            }
          }
        },
        {
          "method": "GET",
          "path": "/api/v1/tasks/:taskId",
          "auth": "Organization member",
          "request": {
            "pathParams": { "taskId": "task_demo_001" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": {
                "id": "task_demo_001",
                "title": "Launch checklist review",
                "status": "In review",
                "priority": "High",
                "progress": 76,
                "due": "2026-10-03",
                "assignee": "Ava",
                "notes": "Confirm final sign-off."
              }
            }
          },
          "note": "The API returns the full task representation."
        },
        {
          "method": "PATCH",
          "path": "/api/v1/tasks/:taskId",
          "auth": "Organization owner, admin, or manager",
          "request": {
            "pathParams": { "taskId": "task_demo_001" },
            "query": {},
            "body": { "status": "Done", "progress": 100 }
          },
          "responses": {
            "200": {
              "data": {
                "id": "task_demo_001",
                "status": "Done",
                "progress": 100,
                "completedAt": "2026-10-03T12:00:00.000Z"
              }
            }
          },
          "note": "The API returns the full task representation."
        },
        {
          "method": "POST",
          "path": "/api/v1/tasks/:taskId/archive",
          "auth": "Organization owner, admin, or manager",
          "request": {
            "pathParams": { "taskId": "task_demo_001" },
            "query": {},
            "body": null
          },
          "responses": { "204": null },
          "effects": ["Archived tasks are hidden from regular lists"]
        },
        {
          "method": "DELETE",
          "path": "/api/v1/tasks/:taskId",
          "auth": "Organization owner or admin",
          "request": {
            "pathParams": { "taskId": "task_demo_001" },
            "query": {},
            "body": null
          },
          "responses": { "204": null }
        },
        {
          "method": "GET",
          "path": "/api/v1/tasks/:taskId/comments",
          "auth": "Organization member",
          "request": {
            "pathParams": { "taskId": "task_demo_001" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "comment_demo_001",
                  "body": "Looks good.",
                  "author": {
                    "id": "usr_demo_001",
                    "name": "Ariana Patel",
                    "email": "team@flowops.example"
                  },
                  "createdAt": "2026-10-03T12:00:00.000Z"
                }
              ]
            }
          }
        },
        {
          "method": "POST",
          "path": "/api/v1/tasks/:taskId/comments",
          "auth": "Organization member",
          "request": {
            "pathParams": { "taskId": "task_demo_001" },
            "query": {},
            "body": { "body": "Please confirm the final launch date." }
          },
          "responses": {
            "201": {
              "data": {
                "id": "comment_demo_002",
                "body": "Please confirm the final launch date.",
                "author": {
                  "id": "usr_demo_001",
                  "name": "Ariana Patel",
                  "email": "team@flowops.example"
                },
                "createdAt": "2026-10-03T12:00:00.000Z"
              }
            }
          }
        },
        {
          "method": "PATCH",
          "path": "/api/v1/tasks/:taskId/comments/:commentId",
          "auth": "Comment author or organization owner/admin",
          "request": {
            "pathParams": {
              "taskId": "task_demo_001",
              "commentId": "comment_demo_002"
            },
            "query": {},
            "body": { "body": "Updated comment text." }
          },
          "responses": {
            "200": {
              "data": {
                "id": "comment_demo_002",
                "body": "Updated comment text.",
                "author": {
                  "id": "usr_demo_001",
                  "name": "Ariana Patel",
                  "email": "team@flowops.example"
                }
              }
            }
          }
        },
        {
          "method": "DELETE",
          "path": "/api/v1/tasks/:taskId/comments/:commentId",
          "auth": "Comment author or organization owner/admin",
          "request": {
            "pathParams": {
              "taskId": "task_demo_001",
              "commentId": "comment_demo_002"
            },
            "query": {},
            "body": null
          },
          "responses": { "204": null }
        }
      ],
      "statuses": ["Queued", "In review", "Blocked", "Done"],
      "priorities": ["High", "Medium", "Low"],
      "dueExamples": ["Today", "Tomorrow", "Unscheduled", "Completed", "A parseable date"]
    },
    {
      "group": "Dashboard and analytics",
      "routes": [
        {
          "method": "GET",
          "paths": [
            "/api/v1/dashboard/overview",
            "/api/v1/organizations/:organizationId/dashboard/overview"
          ],
          "auth": "Organization member",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": {
                "projects": {
                  "total": 4,
                  "atRisk": 1,
                  "byStatus": { "On track": 2, "At risk": 1, "Review": 1 }
                },
                "tasks": {
                  "total": 4,
                  "open": 3,
                  "completed": 1,
                  "dueToday": 1,
                  "byStatus": {
                    "Queued": 1,
                    "In review": 1,
                    "Blocked": 1,
                    "Done": 1
                  },
                  "recent": []
                },
                "weeklyThroughput": [
                  { "date": "2026-09-27", "day": "Sun", "completed": 0 }
                ],
                "activity": [],
                "team": [
                  {
                    "id": "usr_demo_001",
                    "name": "Ariana Patel",
                    "email": "team@flowops.example",
                    "role": "Owner"
                  }
                ],
                "notifications": { "unread": 0 }
              }
            }
          }
        },
        {
          "method": "GET",
          "path": "/api/v1/projects/summary",
          "auth": "Organization member",
          "request": {
            "pathParams": {},
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": {
                "total": 4,
                "byStatus": { "On track": 2, "At risk": 1, "Review": 1 },
                "portfolioValue": 402000,
                "averageProgress": 76,
                "milestonesDueThisMonth": 2
              }
            }
          }
        },
        {
          "method": "GET",
          "paths": [
            "/api/v1/analytics/overview",
            "/api/v1/organizations/:organizationId/analytics/overview"
          ],
          "auth": "Organization member",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": {
                "projects": { "total": 4, "atRisk": 1 },
                "tasks": { "total": 4, "open": 3, "completed": 1 },
                "tasksByStatus": {
                  "Queued": 1,
                  "In review": 1,
                  "Blocked": 1,
                  "Done": 1
                }
              }
            }
          }
        }
      ],
      "note": "Metrics come from persisted project/task records. Revenue pipeline, retention, acquisition cost, and other frontend mock metrics are not returned."
    },
    {
      "group": "Notifications, activity, and audit",
      "routes": [
        {
          "method": "GET",
          "paths": [
            "/api/v1/notifications",
            "/api/v1/organizations/:organizationId/notifications"
          ],
          "auth": "Organization member",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {
              "page": 1,
              "pageSize": 50,
              "read": false,
              "dismissed": false
            },
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "notification_demo_001",
                  "type": "APPROVAL_REQUIRED",
                  "title": "Approval needed",
                  "message": "A task needs review.",
                  "targetType": "TASK",
                  "targetId": "task_demo_001",
                  "readAt": null,
                  "dismissedAt": null,
                  "createdAt": "2026-10-03T12:00:00.000Z"
                }
              ],
              "meta": {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "pageCount": 1,
                "unread": 1
              }
            }
          }
        },
        {
          "method": "PATCH",
          "paths": [
            "/api/v1/notifications/:notificationId",
            "/api/v1/organizations/:organizationId/notifications/:notificationId"
          ],
          "auth": "Notification recipient",
          "request": {
            "pathParams": { "notificationId": "notification_demo_001" },
            "query": {},
            "body": { "read": true, "dismissed": false }
          },
          "responses": {
            "200": {
              "data": {
                "id": "notification_demo_001",
                "readAt": "2026-10-03T12:00:00.000Z",
                "dismissedAt": null
              }
            }
          },
          "constraints": ["Provide read, dismissed, or both"]
        },
        {
          "method": "POST",
          "path": "/api/v1/notifications/:notificationId/read",
          "auth": "Notification recipient",
          "request": {
            "pathParams": { "notificationId": "notification_demo_001" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": {
                "id": "notification_demo_001",
                "readAt": "2026-10-03T12:00:00.000Z",
                "dismissedAt": null
              }
            }
          }
        },
        {
          "method": "POST",
          "path": "/api/v1/notifications/:notificationId/dismiss",
          "auth": "Notification recipient",
          "request": {
            "pathParams": { "notificationId": "notification_demo_001" },
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": {
                "id": "notification_demo_001",
                "readAt": null,
                "dismissedAt": "2026-10-03T12:00:00.000Z"
              }
            }
          }
        },
        {
          "method": "GET",
          "paths": [
            "/api/v1/activity",
            "/api/v1/organizations/:organizationId/activity"
          ],
          "auth": "Organization member",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {
              "page": 1,
              "pageSize": 50,
              "targetType": "TASK",
              "targetId": "task_demo_001"
            },
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "activity_demo_001",
                  "action": "TASK_UPDATED",
                  "targetType": "TASK",
                  "targetId": "task_demo_001",
                  "summary": "Updated task status",
                  "actor": {
                    "id": "usr_demo_001",
                    "name": "Ariana Patel"
                  },
                  "createdAt": "2026-10-03T12:00:00.000Z"
                }
              ],
              "meta": {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "pageCount": 1
              }
            }
          }
        },
        {
          "method": "GET",
          "paths": [
            "/api/v1/audit",
            "/api/v1/organizations/:organizationId/audit"
          ],
          "auth": "Organization member",
          "request": {
            "pathParams": { "organizationId": "org_demo_001" },
            "query": {
              "page": 1,
              "pageSize": 50,
              "targetType": "USER",
              "targetId": "usr_demo_002"
            },
            "body": null
          },
          "responses": {
            "200": {
              "data": [
                {
                  "id": "audit_demo_001",
                  "action": "USER_CREATED",
                  "targetType": "USER",
                  "targetId": "usr_demo_002",
                  "metadata": { "role": "MEMBER" },
                  "actor": {
                    "id": "usr_demo_001",
                    "name": "Ariana Patel"
                  },
                  "createdAt": "2026-10-03T12:00:00.000Z"
                }
              ],
              "meta": {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "pageCount": 1
              }
            }
          }
        }
      ]
    },
    {
      "group": "Account monitoring and website traffic",
      "privacy": "Stores event type, path, timestamp, account, role, and workspace when available; does not store IP addresses or device/browser fingerprints.",
      "routes": [
        {
          "method": "POST",
          "path": "/api/v1/traffic/page-view",
          "auth": "Public; associates the session user and selected workspace when a valid session cookie is present",
          "request": {
            "pathParams": {},
            "query": {},
            "body": { "path": "/projects" }
          },
          "responses": {
            "202": { "recorded": true },
            "400": {
              "error": {
                "code": "VALIDATION_ERROR",
                "message": "The request contains invalid data."
              }
            }
          }
        },
        {
          "method": "GET",
          "path": "/api/v1/admin/monitoring",
          "auth": "Built-in organization owner or admin only",
          "request": {
            "pathParams": {},
            "query": {},
            "body": null
          },
          "responses": {
            "200": {
              "data": {
                "events": [
                  {
                    "id": "monitoring_demo_001",
                    "type": "LOGIN",
                    "role": "Owner",
                    "user": {
                      "id": "usr_demo_001",
                      "name": "Ariana Patel",
                      "email": "team@flowops.example"
                    },
                    "actor": null,
                    "createdAt": "2026-10-03T12:00:00.000Z"
                  }
                ],
                "traffic": {
                  "totalPageViews": 125,
                  "pageViewsToday": 8,
                  "recentPageViews": [
                    {
                      "id": "monitoring_demo_002",
                      "path": "/projects",
                      "user": null,
                      "organization": null,
                      "createdAt": "2026-10-03T12:00:00.000Z"
                    }
                  ]
                }
              }
            },
            "403": {
              "error": {
                "code": "FORBIDDEN",
                "message": "An organization owner or admin is required."
              }
            }
          }
        }
      ]
    }
  ],
  "notImplemented": [
    "File upload/download routes; attachment storage requires an object-storage provider.",
    "Invitation create/accept and invitation email routes.",
    "Public self-service signup; accounts are created by workspace owners/admins."
  ]
}
```
