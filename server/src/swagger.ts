import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'RepairConnect API',
      version: '1.0.0',
      description:
        'REST API for the RepairConnect multi-shop repair network. All business rules are enforced server-side. Public registration is customer-only; staff are created by shop admins.'
    },
    servers: [{ url: 'http://localhost:5000', description: 'Local development' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'rc_access',
          description: 'HttpOnly access cookie (browser sessions)'
        },
        ProvisioningKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Provisioning-Key',
          description: 'Server-side provisioning secret (CLI / automation only)'
        }
      }
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: [
      { name: 'Auth' },
      { name: 'Shops' },
      { name: 'Repairs' },
      { name: 'Parts' },
      { name: 'Notifications' },
      { name: 'Appointments' },
      { name: 'Suppliers' },
      { name: 'Transfers' },
      { name: 'Reports' },
      { name: 'Public' },
      { name: 'ShopApplications' },
      { name: 'Provisioning' },
      { name: 'Platform' }
    ],
    paths: {
      '/api/v1/auth/register': {
        post: {
          tags: ['Auth'],
          security: [],
          summary: 'Public customer registration only',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password', 'name'],
                  properties: {
                    email: { type: 'string' },
                    password: { type: 'string' },
                    name: { type: 'string' },
                    role: { type: 'string', enum: ['customer'] },
                    preferredLanguage: { type: 'string', enum: ['en', 'ur'] }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'Registered as customer' },
            '400': { description: 'Validation failed (e.g. privileged role rejected)' }
          }
        }
      },
      '/api/v1/auth/login': {
        post: {
          tags: ['Auth'],
          security: [],
          summary: 'Login',
          responses: { '200': { description: 'JWT issued' }, '401': { description: 'Invalid credentials' } }
        }
      },
      '/api/v1/auth/forgot-password': {
        post: {
          tags: ['Auth'],
          security: [],
          summary: 'Request password reset (non-enumerating response)',
          responses: { '200': { description: 'Always succeeds with generic message' } }
        }
      },
      '/api/v1/auth/me': {
        get: { tags: ['Auth'], summary: 'Current user profile' }
      },
      '/api/v1/auth/me/language': {
        patch: { tags: ['Auth'], summary: 'Update preferred language (en|ur)' }
      },
      '/api/v1/auth/staff': {
        get: { tags: ['Auth'], summary: 'List staff for admin shop' },
        post: {
          tags: ['Auth'],
          summary: 'Create staff user + shop membership (shop_admin only)',
          responses: {
            '201': { description: 'Staff created' },
            '403': { description: 'Forbidden' }
          }
        }
      },
      '/api/v1/shops': {
        get: {
          tags: ['Shops'],
          security: [],
          summary: 'List active shops',
          responses: { '200': { description: 'Shop list' } }
        },
        post: {
          tags: ['Shops'],
          summary: 'Create shop + membership (shop_admin)',
          responses: { '201': { description: 'Shop created' }, '403': { description: 'Forbidden' } }
        }
      },
      '/api/v1/shops/mine': {
        get: { tags: ['Shops'], summary: 'List shops the current user may access' }
      },
      '/api/v1/shops/{id}': {
        get: { tags: ['Shops'], summary: 'Shop detail (authorized membership required)' },
        patch: { tags: ['Shops'], summary: 'Update shop profile (shop_admin)' }
      },
      '/api/v1/shops/{id}/archive': {
        post: {
          tags: ['Shops'],
          summary: 'Archive shop after blocker checks (no hard delete)',
          responses: {
            '200': { description: 'Shop archived' },
            '409': { description: 'Unresolved blockers prevent archive' }
          }
        }
      },
      '/api/v1/shops/{id}/archive-check': {
        get: { tags: ['Shops'], summary: 'Preview archive blockers for a shop' }
      },
      '/api/v1/repairs': {
        get: { tags: ['Repairs'], summary: 'List repairs for current user' },
        post: { tags: ['Repairs'], summary: 'Submit repair request (customer)' }
      },
      '/api/v1/repairs/stats/summary': {
        get: { tags: ['Repairs'], summary: 'Dashboard stats for current user scope' }
      },
      '/api/v1/repairs/{id}': {
        get: { tags: ['Repairs'], summary: 'Repair detail with history, estimates, parts' }
      },
      '/api/v1/repairs/{id}/assign': {
        post: { tags: ['Repairs'], summary: 'Assign mechanic (shop admin)' }
      },
      '/api/v1/repairs/{id}/diagnosis': {
        post: { tags: ['Repairs'], summary: 'Record diagnosis (mechanic)' }
      },
      '/api/v1/repairs/{id}/estimates': {
        post: { tags: ['Repairs'], summary: 'Submit estimate (mechanic)' }
      },
      '/api/v1/repairs/estimates/{estimateId}/decision': {
        post: { tags: ['Repairs'], summary: 'Approve or reject estimate (customer)' }
      },
      '/api/v1/repairs/{id}/parts-requests': {
        post: { tags: ['Repairs'], summary: 'Request spare parts (mechanic)' }
      },
      '/api/v1/repairs/{id}/start': {
        post: { tags: ['Repairs'], summary: 'Start repair work (mechanic)' }
      },
      '/api/v1/repairs/{id}/complete': {
        post: { tags: ['Repairs'], summary: 'Complete repair (mechanic)' }
      },
      '/api/v1/parts': {
        get: { tags: ['Parts'], summary: 'List inventory' },
        post: { tags: ['Parts'], summary: 'Create part' }
      },
      '/api/v1/parts/{id}/stock-in': {
        post: { tags: ['Parts'], summary: 'Record stock arrival' }
      },
      '/api/v1/parts/requests/incoming': {
        get: { tags: ['Parts'], summary: 'Incoming parts requests' }
      },
      '/api/v1/parts/requests/{id}/reserve': {
        post: { tags: ['Parts'], summary: 'Atomically reserve stock for a parts request' }
      },
      '/api/v1/parts/requests/{id}/reject': {
        post: { tags: ['Parts'], summary: 'Reject parts request' }
      },
      '/api/v1/parts/reservations/{id}/release': {
        post: { tags: ['Parts'], summary: 'Release an active reservation' }
      },
      '/api/v1/parts/movements': {
        get: { tags: ['Parts'], summary: 'Inventory movement history' }
      },
      '/api/v1/notifications': {
        get: { tags: ['Notifications'], summary: 'List notifications' }
      },
      '/api/v1/notifications/read-all': {
        post: { tags: ['Notifications'], summary: 'Mark all notifications read' }
      },
      '/api/v1/auth/me/notifications': {
        patch: { tags: ['Auth'], summary: 'Update in-app notification preferences' }
      },
      '/api/v1/repairs/{id}/workspace': {
        patch: { tags: ['Repairs'], summary: 'Mechanic workspace updates (notes, checklist, labor, photos)' }
      },
      '/api/v1/repairs/{id}/feedback': {
        post: { tags: ['Repairs'], summary: 'Customer feedback after completion' }
      },
      '/api/v1/repairs/{id}/receipt': {
        get: { tags: ['Repairs'], summary: 'Downloadable receipt payload for completed repairs' }
      },
      '/api/v1/repairs/{id}/payments': {
        get: {
          tags: ['Repairs'],
          summary: 'Payment ledger summary (total due, paid, outstanding) from PaymentRecords'
        }
      },
      '/api/v1/repairs/{id}/collect': {
        post: {
          tags: ['Repairs'],
          summary: 'Confirm device collection (does not close case)'
        }
      },
      '/api/v1/repairs/{id}/close': {
        post: {
          tags: ['Repairs'],
          summary: 'Close case after collection + zero outstanding (shop_admin)'
        }
      },
      '/api/v1/repairs/{id}/reopen': {
        post: {
          tags: ['Repairs'],
          summary: 'Reopen closed case with mandatory audited reason (shop_admin)'
        }
      },
      '/api/v1/repairs/{id}/customer-updates': {
        post: {
          tags: ['Repairs'],
          summary: 'Post customer-visible status/progress update'
        }
      },
      '/api/v1/parts/{id}/adjust': {
        post: { tags: ['Parts'], summary: 'Adjust stock with mandatory reason (no negative inventory)' }
      },
      '/api/v1/appointments': {
        get: { tags: ['Appointments'], summary: 'List appointments for current user' },
        post: { tags: ['Appointments'], summary: 'Book appointment (prevents double booking)' }
      },
      '/api/v1/appointments/slots': {
        get: {
          tags: ['Appointments'],
          security: [],
          summary: 'List available appointment slots for a shop/date'
        }
      },
      '/api/v1/appointments/{id}/cancel': {
        post: { tags: ['Appointments'], summary: 'Cancel appointment per shop policy' }
      },
      '/api/v1/appointments/{id}/reschedule': {
        post: { tags: ['Appointments'], summary: 'Reschedule appointment' }
      },
      '/api/v1/suppliers': {
        get: { tags: ['Suppliers'], summary: 'List suppliers for shop' },
        post: { tags: ['Suppliers'], summary: 'Create supplier' }
      },
      '/api/v1/suppliers/restock-requests': {
        get: { tags: ['Suppliers'], summary: 'List restock requests' },
        post: { tags: ['Suppliers'], summary: 'Create restock request' }
      },
      '/api/v1/transfers': {
        get: { tags: ['Transfers'], summary: 'List shop-to-shop transfers' },
        post: { tags: ['Transfers'], summary: 'Request stock transfer' }
      },
      '/api/v1/transfers/{id}/approve': {
        post: { tags: ['Transfers'], summary: 'Approve transfer' }
      },
      '/api/v1/transfers/{id}/dispatch': {
        post: { tags: ['Transfers'], summary: 'Dispatch transfer (deduct source stock)' }
      },
      '/api/v1/transfers/{id}/receive': {
        post: { tags: ['Transfers'], summary: 'Receive transfer (add destination stock)' }
      },
      '/api/v1/reports/operations': {
        get: { tags: ['Reports'], summary: 'Shop operations analytics from live records' }
      },
      '/api/v1/reports/operations.csv': {
        get: { tags: ['Reports'], summary: 'Export operations CSV' }
      },
      '/api/v1/reports/center': {
        get: {
          tags: ['Reports'],
          summary:
            'Reports center (repairs/financial/inventory/mechanic/customer). Revenue uses PaymentRecord only. Role-scoped.'
        }
      },
      '/api/v1/reports/center.csv': {
        get: { tags: ['Reports'], summary: 'Export reports center CSV for authorized category' }
      },
      '/api/v1/documents/issue': {
        post: {
          tags: ['Reports'],
          summary: 'Issue financial document snapshot (invoice/receipt/etc.)'
        }
      },
      '/api/v1/documents/payments': {
        post: {
          tags: ['Reports'],
          summary:
            'Record confirmed payment atomically (MongoDB transaction + financialRevision); does not invent revenue from finalCost'
        }
      },
      '/api/v1/documents/payments/{id}/reverse': {
        post: {
          tags: ['Reports'],
          summary:
            'Shop Admin only: partial or full payment reversal with mandatory reason (atomic ledger entry)'
        }
      },
      '/api/v1/public/track/{token}': {
        get: {
          tags: ['Public'],
          security: [],
          summary: 'Public repair tracking by high-entropy token (sanitized, no customer PII)'
        }
      },
      '/api/v1/public/track/lookup': {
        post: {
          tags: ['Public'],
          security: [],
          summary:
            'Public tracking lookup by repair reference + private access code (hashed server-side; uniform TRACKING_DENIED)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['referenceNumber', 'accessCode'],
                  properties: {
                    referenceNumber: { type: 'string' },
                    accessCode: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
      '/api/v1/public/shop-applications': {
        post: {
          tags: ['Public'],
          security: [],
          summary: 'Submit pending repair shop application (does not create Shop Admin account)'
        }
      },
      '/api/v1/public/shop-applications/{id}': {
        get: {
          tags: ['Public'],
          security: [],
          summary: 'Check shop application status with matching business email'
        }
      },
      '/api/v1/public/shop-applications/register': {
        post: {
          tags: ['Public'],
          security: [],
          summary:
            'Register shop owner account (pending_shop_owner) + shop application in one transaction'
        }
      },
      '/api/v1/shop-applications/mine': {
        get: {
          tags: ['ShopApplications'],
          summary: 'Authenticated owner: own application status only'
        }
      },
      '/api/v1/shop-applications/provision/approve': {
        post: {
          tags: ['Provisioning'],
          security: [{ ProvisioningKey: [] }],
          summary: 'Approve application with X-Provisioning-Key (automation / CLI)'
        }
      },
      '/api/v1/shop-applications/provision/reject': {
        post: {
          tags: ['Provisioning'],
          security: [{ ProvisioningKey: [] }],
          summary: 'Reject application with X-Provisioning-Key (requires reason)'
        }
      },
      '/api/v1/platform/shop-applications': {
        get: {
          tags: ['Platform'],
          summary:
            'List shop applications for platform_operator only (filter: pending|approved|rejected|all)'
        }
      },
      '/api/v1/platform/shop-applications/{publicId}': {
        get: {
          tags: ['Platform'],
          summary: 'Application detail for platform_operator review'
        }
      },
      '/api/v1/platform/shop-applications/{publicId}/approve': {
        post: {
          tags: ['Platform'],
          summary:
            'Approve application: create one shop + one shop_admin membership; records reviewer + audit'
        }
      },
      '/api/v1/platform/shop-applications/{publicId}/reject': {
        post: {
          tags: ['Platform'],
          summary: 'Reject application (reason required, min 5 chars); records reviewer + audit'
        }
      },
      '/api/v1/repairs/{id}/messages': {
        get: {
          tags: ['Repairs'],
          summary: 'List repair messages (customers see customer_visible only)'
        },
        post: {
          tags: ['Repairs'],
          summary: 'Post a repair message (visibility enforced server-side)'
        }
      },
      '/api/v1/repairs/{id}/tracking-events': {
        get: {
          tags: ['Repairs'],
          summary: 'List tracking milestones for a repair (visibility filtered by role)'
        }
      },
      '/api/v1/repairs/{id}/tracking/regenerate': {
        post: {
          tags: ['Repairs'],
          summary: 'Regenerate tracking token and access code (invalidates prior credentials)'
        }
      },
      '/health': {
        get: {
          tags: ['Auth'],
          security: [],
          summary: 'Health check (includes dbMode, never secrets)'
        }
      }
    }
  },
  apis: []
});
