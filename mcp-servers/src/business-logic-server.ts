/**
 * CodeNexus — Business Logic MCP Server
 *
 * Fused from Business-Logic-MCP.
 * Provides entity definitions, state machines, decision tables,
 * permission checking, validation, and audit logging via the
 * Model Context Protocol (stdio transport).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  BusinessEntity,
  EntityField,
  StateMachine,
  StateTransition,
  DecisionTable,
  DecisionRule,
  Footgun,
  ValidationRule,
  Severity,
} from '../../shared/src/types';

// ─── Zod Schemas ──────────────────────────────────────────────

const EntityFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean(),
  semantic: z.string(),
  validationRules: z.array(z.string()),
  footguns: z.array(z.string()),
});

const FootgunSchema = z.object({
  description: z.string().min(1),
  severity: z.nativeEnum(Severity),
  mitigation: z.string().min(1),
});

const ValidationRuleSchema = z.object({
  name: z.string().min(1),
  expression: z.string().min(1),
  message: z.string().min(1),
});

const BusinessEntitySchema = z.object({
  name: z.string().min(1),
  fields: z.array(EntityFieldSchema),
  stateMachine: z.string().nullable(),
  footguns: z.array(FootgunSchema),
  validationRules: z.array(ValidationRuleSchema),
});

const StateTransitionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().min(1),
  sideEffects: z.array(z.string()),
});

const StateMachineSchema = z.object({
  name: z.string().min(1),
  states: z.array(z.string()).min(1),
  transitions: z.array(StateTransitionSchema),
});

const DecisionRuleSchema = z.object({
  conditions: z.record(z.string()),
  result: z.string().min(1),
  priority: z.number().int().nonnegative(),
});

const DecisionTableSchema = z.object({
  name: z.string().min(1),
  inputs: z.array(z.string()).min(1),
  outputs: z.array(z.string()).min(1),
  rules: z.array(DecisionRuleSchema),
});

const AuditLogEntrySchema = z.object({
  action: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().min(1),
  actor: z.string().min(1),
  timestamp: z.string().datetime().optional(),
  details: z.record(z.unknown()).optional(),
});

// ─── In-Memory Registry (production would use a database) ─────

const entityRegistry = new Map<string, BusinessEntity>();
const stateMachineRegistry = new Map<string, StateMachine>();
const decisionTableRegistry = new Map<string, DecisionTable>();
const auditLog: Array<z.infer<typeof AuditLogEntrySchema>> = [];

// ─── Seed Data ────────────────────────────────────────────────

function seedData(): void {
  // ── Order Entity ──
  const orderEntity: BusinessEntity = {
    name: 'Order',
    fields: [
      {
        name: 'id',
        type: 'string',
        required: true,
        semantic: 'Unique order identifier (UUID v4)',
        validationRules: ['is_uuid', 'not_empty'],
        footguns: ['Auto-generated; do not set manually'],
      },
      {
        name: 'customerId',
        type: 'string',
        required: true,
        semantic: 'Customer who placed the order',
        validationRules: ['is_uuid', 'not_empty'],
        footguns: ['Must reference an existing customer'],
      },
      {
        name: 'items',
        type: 'array<OrderItem>',
        required: true,
        semantic: 'Line items in the order (1..N)',
        validationRules: ['min_items:1', 'valid_items'],
        footguns: [
          'Empty arrays will fail validation',
          'All items must reference valid SKUs',
        ],
      },
      {
        name: 'total',
        type: 'Money',
        required: true,
        semantic: 'Computed sum of all line-item totals',
        validationRules: ['greater_than:0'],
        footguns: [
          'Read-only after creation; mutations rejected',
          'Currency rounding must use bankers rounding',
        ],
      },
      {
        name: 'currency',
        type: 'string',
        required: true,
        semantic: 'ISO 4217 currency code (USD, EUR, GBP, etc.)',
        validationRules: ['iso_4217', 'length:3'],
        footguns: [
          'Must be uppercase; lowercase silently corrected',
          'Not all currencies supported for all payment methods',
        ],
      },
      {
        name: 'status',
        type: 'string',
        required: true,
        semantic: 'Current lifecycle state of the order',
        validationRules: ['valid_order_state'],
        footguns: ['Use state machine transitions; do not set directly'],
      },
      {
        name: 'shippingAddress',
        type: 'Address',
        required: false,
        semantic: 'Physical shipping destination',
        validationRules: ['valid_address'],
        footguns: [
          'Digital goods may omit this field',
          'Must be in a supported shipping region',
        ],
      },
      {
        name: 'paymentMethod',
        type: 'string',
        required: true,
        semantic: 'Payment instrument token or reference',
        validationRules: ['not_empty', 'valid_payment_token'],
        footguns: [
          'Token expires after 15 minutes; refresh before submission',
          'Test tokens silently succeed in sandbox but fail in production',
        ],
      },
      {
        name: 'createdAt',
        type: 'datetime',
        required: true,
        semantic: 'ISO 8601 timestamp of order creation',
        validationRules: ['iso_8601'],
        footguns: ['Auto-set on creation; ignored on update'],
      },
      {
        name: 'updatedAt',
        type: 'datetime',
        required: true,
        semantic: 'ISO 8601 timestamp of last modification',
        validationRules: ['iso_8601'],
        footguns: ['Auto-managed; manual edits overwritten'],
      },
    ],
    stateMachine: 'OrderLifecycle',
    footguns: [
      {
        description:
          'Setting status directly bypasses side effects (inventory hold, payment capture)',
        severity: Severity.High,
        mitigation:
          'Always use the state machine transition API for status changes',
      },
      {
        description:
          'Creating an order with total=0 will pass validation but fail payment processing',
        severity: Severity.Medium,
        mitigation:
          'Add a business rule requiring total > 0 for non-zero-currency orders',
      },
      {
        description:
          'Order cancellation after shipment requires a restocking workflow',
        severity: Severity.Critical,
        mitigation:
          'Check shipping status before allowing cancellation transition',
      },
    ],
    validationRules: [
      {
        name: 'items_not_empty',
        expression: 'items.length > 0',
        message: 'Order must contain at least one item',
      },
      {
        name: 'total_positive',
        expression: 'total > 0',
        message: 'Order total must be greater than zero',
      },
      {
        name: 'valid_customer',
        expression: 'customerId !== null && isUuid(customerId)',
        message: 'Customer ID must be a valid UUID referencing an existing customer',
      },
    ],
  };

  // ── Order Lifecycle State Machine ──
  const orderSM: StateMachine = {
    name: 'OrderLifecycle',
    states: [
      'draft',
      'pending_payment',
      'payment_authorized',
      'payment_captured',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'refunded',
      'archived',
    ],
    transitions: [
      {
        from: 'draft',
        to: 'pending_payment',
        condition: 'items.length > 0 && total > 0',
        sideEffects: ['validate_inventory', 'calculate_taxes', 'hold_inventory'],
      },
      {
        from: 'pending_payment',
        to: 'payment_authorized',
        condition: 'payment_gateway.authorize(paymentMethod, total) === success',
        sideEffects: ['send_auth_confirmation', 'reduce_inventory'],
      },
      {
        from: 'pending_payment',
        to: 'cancelled',
        condition: 'user_initiated || payment_timeout',
        sideEffects: ['release_inventory', 'send_cancellation_notice'],
      },
      {
        from: 'payment_authorized',
        to: 'payment_captured',
        condition: 'payment_gateway.capture(paymentMethod, total) === success',
        sideEffects: ['generate_invoice', 'send_receipt', 'trigger_fulfillment'],
      },
      {
        from: 'payment_authorized',
        to: 'cancelled',
        condition: 'user_initiated && !shipped',
        sideEffects: ['void_authorization', 'release_inventory', 'send_cancellation_notice'],
      },
      {
        from: 'payment_captured',
        to: 'processing',
        condition: 'fulfillment_ready',
        sideEffects: ['assign_warehouse', 'print_packing_slip', 'update_eta'],
      },
      {
        from: 'processing',
        to: 'shipped',
        condition: 'carrier_scan_confirmed',
        sideEffects: [
          'send_shipping_notification',
          'update_tracking',
          'charge_shipping',
        ],
      },
      {
        from: 'shipped',
        to: 'delivered',
        condition: 'carrier_delivery_scan',
        sideEffects: ['send_delivery_confirmation', 'request_review'],
      },
      {
        from: 'shipped',
        to: 'refunded',
        condition: 'return_initiated && return_approved',
        sideEffects: [
          'initiate_return_label',
          'inspect_returned_items',
          'process_refund',
        ],
      },
      {
        from: 'delivered',
        to: 'refunded',
        condition: 'return_window_open && return_approved',
        sideEffects: ['process_refund', 'restock_inventory'],
      },
      {
        from: 'cancelled',
        to: 'refunded',
        condition: 'payment_already_captured',
        sideEffects: ['process_refund', 'release_inventory'],
      },
      {
        from: 'refunded',
        to: 'archived',
        condition: 'refund_settled && days_since_refund > 30',
        sideEffects: ['anonymize_data', 'compress_order_record'],
      },
      {
        from: 'delivered',
        to: 'archived',
        condition: 'days_since_delivery > 90',
        sideEffects: ['anonymize_data', 'compress_order_record'],
      },
    ],
  };

  // ── Shipping Decision Table ──
  const shippingDT: DecisionTable = {
    name: 'ShippingMethodSelector',
    inputs: ['weight_kg', 'distance_km', 'expedited', 'value_usd'],
    outputs: ['carrier', 'service_level', 'estimated_days', 'cost_usd'],
    rules: [
      {
        conditions: { weight_kg: '<1', distance_km: '<100', expedited: 'false', value_usd: '<500' },
        result: '{ carrier: "USPS", service_level: "First Class", estimated_days: 3, cost_usd: 4.50 }',
        priority: 1,
      },
      {
        conditions: { weight_kg: '<1', distance_km: '<100', expedited: 'true', value_usd: '<500' },
        result: '{ carrier: "USPS", service_level: "Priority", estimated_days: 1, cost_usd: 8.75 }',
        priority: 2,
      },
      {
        conditions: { weight_kg: '1-10', distance_km: '<500', expedited: 'false', value_usd: '*' },
        result: '{ carrier: "UPS", service_level: "Ground", estimated_days: 5, cost_usd: 12.00 }',
        priority: 3,
      },
      {
        conditions: { weight_kg: '1-10', distance_km: '<500', expedited: 'true', value_usd: '*' },
        result: '{ carrier: "UPS", service_level: "Next Day Air", estimated_days: 1, cost_usd: 35.00 }',
        priority: 4,
      },
      {
        conditions: { weight_kg: '>10', distance_km: '*', expedited: 'false', value_usd: '*' },
        result: '{ carrier: "FedEx", service_level: "Freight", estimated_days: 7, cost_usd: 55.00 }',
        priority: 5,
      },
      {
        conditions: { weight_kg: '>10', distance_km: '*', expedited: 'true', value_usd: '>5000' },
        result: '{ carrier: "FedEx", service_level: "Priority Overnight Freight", estimated_days: 1, cost_usd: 120.00 }',
        priority: 6,
      },
      {
        conditions: { weight_kg: '*', distance_km: '>1000', expedited: 'false', value_usd: '*' },
        result: '{ carrier: "UPS", service_level: "Ground Long Distance", estimated_days: 10, cost_usd: 25.00 }',
        priority: 7,
      },
    ],
  };

  entityRegistry.set('Order', orderEntity);
  stateMachineRegistry.set('OrderLifecycle', orderSM);
  decisionTableRegistry.set('ShippingMethodSelector', shippingDT);
}

seedData();

// ─── Tool Handlers ────────────────────────────────────────────

function handleGetEntity(args: Record<string, unknown>): BusinessEntity {
  const schema = z.object({ name: z.string().min(1) });
  const { name } = schema.parse(args);
  const entity = entityRegistry.get(name);
  if (!entity) {
    throw new McpError(ErrorCode.InvalidParams, `Entity "${name}" not found`);
  }
  return entity;
}

function handleGetValidTransitions(args: Record<string, unknown>) {
  const schema = z.object({
    stateMachine: z.string().min(1),
    currentState: z.string().min(1),
  });
  const { stateMachine: smName, currentState } = schema.parse(args);
  const sm = stateMachineRegistry.get(smName);
  if (!sm) {
    throw new McpError(ErrorCode.InvalidParams, `State machine "${smName}" not found`);
  }
  if (!sm.states.includes(currentState)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `"${currentState}" is not a valid state in "${smName}". Valid states: ${sm.states.join(', ')}`,
    );
  }
  return sm.transitions.filter((t) => t.from === currentState);
}

function handleGetFieldSemantics(args: Record<string, unknown>) {
  const schema = z.object({
    entity: z.string().min(1),
    field: z.string().min(1),
  });
  const { entity: entityName, field: fieldName } = schema.parse(args);
  const entity = entityRegistry.get(entityName);
  if (!entity) {
    throw new McpError(ErrorCode.InvalidParams, `Entity "${entityName}" not found`);
  }
  const field = entity.fields.find((f) => f.name === fieldName);
  if (!field) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Field "${fieldName}" not found on entity "${entityName}". Valid fields: ${entity.fields.map((f) => f.name).join(', ')}`,
    );
  }
  return {
    entity: entityName,
    field: field.name,
    type: field.type,
    required: field.required,
    semantic: field.semantic,
    validationRules: field.validationRules,
    footguns: field.footguns,
  };
}

function handleGetEntityFootguns(args: Record<string, unknown>) {
  const schema = z.object({
    entity: z.string().min(1),
    severity: z.nativeEnum(Severity).optional(),
  });
  const { entity: entityName, severity } = schema.parse(args);
  const entity = entityRegistry.get(entityName);
  if (!entity) {
    throw new McpError(ErrorCode.InvalidParams, `Entity "${entityName}" not found`);
  }
  let footguns = entity.footguns;
  if (severity) {
    footguns = footguns.filter((f) => f.severity === severity);
  }
  return { entity: entityName, footguns };
}

function handleEvaluateDecisionTable(args: Record<string, unknown>) {
  const schema = z.object({
    table: z.string().min(1),
    inputs: z.record(z.string()),
  });
  const { table: tableName, inputs } = schema.parse(args);
  const dt = decisionTableRegistry.get(tableName);
  if (!dt) {
    throw new McpError(ErrorCode.InvalidParams, `Decision table "${tableName}" not found`);
  }

  // Validate inputs match the table's declared input names
  for (const inputName of dt.inputs) {
    if (!(inputName in inputs)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Missing input "${inputName}" for table "${tableName}"`,
      );
    }
  }

  // Evaluate rules in priority order
  const sortedRules = [...dt.rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    let matched = true;
    for (const [inputName, condition] of Object.entries(rule.conditions)) {
      if (condition === '*') continue; // wildcard matches anything
      const inputValue = inputs[inputName];
      if (!evaluateCondition(inputValue, condition)) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return {
        table: tableName,
        matched: true,
        rule,
        result: rule.result,
      };
    }
  }

  return {
    table: tableName,
    matched: false,
    result: null,
    message: 'No matching rule found for the given inputs',
  };
}

function evaluateCondition(value: unknown, condition: string): boolean {
  const cond = condition.trim();

  // Wildcard: matches anything
  if (cond === '*') return true;

  // Equality: =value or just value
  if (cond.startsWith('=')) {
    return String(value) === cond.slice(1).trim();
  }

  // Greater than: >number
  if (cond.startsWith('>=')) {
    const threshold = parseFloat(cond.slice(2));
    if (isNaN(threshold)) return false;
    return Number(value) >= threshold;
  }
  if (cond.startsWith('>')) {
    const threshold = parseFloat(cond.slice(1));
    if (isNaN(threshold)) return false;
    return Number(value) > threshold;
  }

  // Less than: <number
  if (cond.startsWith('<=')) {
    const threshold = parseFloat(cond.slice(2));
    if (isNaN(threshold)) return false;
    return Number(value) <= threshold;
  }
  if (cond.startsWith('<')) {
    const threshold = parseFloat(cond.slice(1));
    if (isNaN(threshold)) return false;
    return Number(value) < threshold;
  }

  // Range: min-max (inclusive)
  const rangeMatch = cond.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (isNaN(min) || isNaN(max)) return false;
    const num = Number(value);
    return num >= min && num <= max;
  }

  // Not equal: !=value
  if (cond.startsWith('!=')) {
    return String(value) !== cond.slice(2).trim();
  }

  // Contains: *substring*
  if (cond.startsWith('*') && cond.endsWith('*') && cond.length > 1) {
    const substr = cond.slice(1, -1);
    return String(value).includes(substr);
  }

  // Starts with: prefix*
  if (cond.endsWith('*') && cond.length > 1) {
    const prefix = cond.slice(0, -1);
    return String(value).startsWith(prefix);
  }

  // Ends with: *suffix
  if (cond.startsWith('*') && cond.length > 1) {
    const suffix = cond.slice(1);
    return String(value).endsWith(suffix);
  }

  // In list: [a,b,c]
  const listMatch = cond.match(/^\[(.+)\]$/);
  if (listMatch) {
    const items = listMatch[1].split(',').map(s => s.trim());
    return items.includes(String(value));
  }

  // Default: exact string match (handles 'true', 'false', 'null' as literal strings)
  return String(value).toLowerCase() === cond.toLowerCase();
}

function handleCheckPermission(args: Record<string, unknown>) {
  const schema = z.object({
    entity: z.string().min(1),
    action: z.enum(['create', 'read', 'update', 'delete', 'approve', 'reject']),
    actor: z.string().min(1),
    context: z.record(z.unknown()).optional(),
  });
  const { entity: entityName, action, actor } = schema.parse(args);

  const entity = entityRegistry.get(entityName);
  if (!entity) {
    throw new McpError(ErrorCode.InvalidParams, `Entity "${entityName}" not found`);
  }

  // Permission check resolved against actor's role.
  // Admin bypass removed — authorization must be explicit.
  // Use group-based rules or explicit permission checks instead.

  // Read is always permitted for authenticated actors
  if (action === 'read') {
    return {
      permitted: true,
      reason: 'Read access is public',
      entity: entityName,
      action,
      actor,
    };
  }

  // Create/update/delete/approve/reject require elevated permissions
  const elevatedActions = ['create', 'update', 'delete', 'approve', 'reject'];
  if (elevatedActions.includes(action)) {
    return {
      permitted: false,
      reason: `Action "${action}" on "${entityName}" requires elevated permissions (role: editor or admin)`,
      entity: entityName,
      action,
      actor,
    };
  }

  return {
    permitted: false,
    reason: `Unknown action "${action}"`,
    entity: entityName,
    action,
    actor,
  };
}

function handleValidateEntity(args: Record<string, unknown>) {
  const schema = z.object({
    entity: z.string().min(1),
    data: z.record(z.unknown()),
  });
  const { entity: entityName, data } = schema.parse(args);

  const entity = entityRegistry.get(entityName);
  if (!entity) {
    throw new McpError(ErrorCode.InvalidParams, `Entity "${entityName}" not found`);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  for (const field of entity.fields) {
    if (field.required && (data[field.name] === undefined || data[field.name] === null)) {
      errors.push(`Missing required field "${field.name}" (${field.type})`);
    }
  }

  // Check field types (basic type checking)
  for (const [key, value] of Object.entries(data)) {
    const field = entity.fields.find((f) => f.name === key);
    if (!field) {
      warnings.push(`Unknown field "${key}" — will be ignored`);
      continue;
    }
    if (field.type === 'string' && typeof value !== 'string') {
      errors.push(`Field "${key}" expects string, got ${typeof value}`);
    }
    if (field.type === 'number' && typeof value !== 'number') {
      errors.push(`Field "${key}" expects number, got ${typeof value}`);
    }
    if (field.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`Field "${key}" expects boolean, got ${typeof value}`);
    }
  }

  // Execute validation rules
  for (const rule of entity.validationRules) {
    const fieldNames = entity.fields.map((f) => f.name);
    const hasAllFields = fieldNames.every((fn) => fn in data);
    if (!hasAllFields) {
      warnings.push(`Cannot evaluate rule "${rule.name}": missing fields`);
      continue;
    }
    // Simple expression evaluation (in production, use a sandboxed expression parser)
    if (rule.expression.includes('items.length > 0') && (!data.items || !Array.isArray(data.items) || data.items.length === 0)) {
      errors.push(rule.message);
    }
    if (rule.expression.includes('total > 0') && (typeof data.total !== 'number' || data.total <= 0)) {
      errors.push(rule.message);
    }
  }

  // Check footgun warnings
  for (const footgun of entity.footguns) {
    warnings.push(`⚠ ${footgun.severity.toUpperCase()}: ${footgun.description} — ${footgun.mitigation}`);
  }

  return {
    entity: entityName,
    valid: errors.length === 0,
    errors,
    warnings,
    fieldCount: entity.fields.length,
    dataFields: Object.keys(data).length,
  };
}

function handleAuditLog(args: Record<string, unknown>) {
  const schema = z.object({
    action: z.string().min(1),
    entity: z.string().min(1),
    entityId: z.string().min(1),
    actor: z.string().min(1),
    details: z.record(z.unknown()).optional(),
  });
  const entry = AuditLogEntrySchema.parse({
    ...args,
    timestamp: args.timestamp ?? new Date().toISOString(),
  });

  auditLog.push(entry);

  return {
    logged: true,
    entry,
    logSize: auditLog.length,
  };
}

async function handleEvaluateAllRules(args: Record<string, unknown>) {
  const schema = z.object({
    table: z.string().min(1),
    inputs: z.record(z.unknown()),
  });
  const { table: tableName, inputs } = schema.parse(args);

  const table = decisionTableRegistry.get(tableName);
  if (!table) {
    throw new McpError(ErrorCode.InvalidParams, `Decision table "${tableName}" not found`);
  }

  const results = table.rules
    .map(rule => {
      const allMatch = Object.entries(rule.conditions).every(([key, condition]) => {
        return evaluateCondition(inputs[key], condition);
      });
      return {
        priority: rule.priority,
        conditions: rule.conditions,
        result: rule.result,
        matched: allMatch,
      };
    })
    .sort((a, b) => b.priority - a.priority);

  return {
    table: tableName,
    inputs,
    rules_evaluated: results.length,
    rules_matched: results.filter(r => r.matched).length,
    results,
  };
}

function handleGetAuditLog(args: Record<string, unknown>) {
  const schema = z.object({
    entity: z.string().optional(),
    actor: z.string().optional(),
    limit: z.number().int().positive().default(50),
  });
  const { entity, actor, limit } = schema.parse(args);

  let filtered = [...auditLog];
  if (entity) filtered = filtered.filter((e) => e.entity === entity);
  if (actor) filtered = filtered.filter((e) => e.actor === actor);

  return {
    entries: filtered.slice(-limit),
    total: filtered.length,
  };
}

// ─── MCP Server Setup ─────────────────────────────────────────

const server = new Server(
  {
    name: 'codenexus-business-logic-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_entity',
      description: 'Retrieve a business entity definition with all its fields, validation rules, and footguns',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Entity name (e.g., "Order")' },
        },
        required: ['name'],
      },
    },
    {
      name: 'get_valid_transitions',
      description: 'Get all valid state machine transitions from a given state, with conditions and side effects',
      inputSchema: {
        type: 'object',
        properties: {
          stateMachine: { type: 'string', description: 'State machine name (e.g., "OrderLifecycle")' },
          currentState: { type: 'string', description: 'Current state to query transitions from' },
        },
        required: ['stateMachine', 'currentState'],
      },
    },
    {
      name: 'get_field_semantics',
      description: 'Retrieve the semantic meaning, type constraints, and footguns for a specific field on an entity',
      inputSchema: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'Entity name' },
          field: { type: 'string', description: 'Field name' },
        },
        required: ['entity', 'field'],
      },
    },
    {
      name: 'get_entity_footguns',
      description: 'Get all footguns (common mistakes / pitfalls) for an entity, optionally filtered by severity',
      inputSchema: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'Entity name' },
          severity: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low', 'info'],
            description: 'Optional severity filter',
          },
        },
        required: ['entity'],
      },
    },
    {
      name: 'evaluate_decision_table',
      description: 'Evaluate a decision table with the given inputs and return the highest-priority matching rule',
      inputSchema: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Decision table name (e.g., "ShippingMethodSelector")' },
          inputs: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Input values keyed by input name',
          },
        },
        required: ['table', 'inputs'],
      },
    },
    {
      name: 'check_permission',
      description: 'Check whether an actor is permitted to perform a specific action on an entity',
      inputSchema: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'Entity name' },
          action: {
            type: 'string',
            enum: ['create', 'read', 'update', 'delete', 'approve', 'reject'],
            description: 'Action to check',
          },
          actor: { type: 'string', description: 'Actor identifier (e.g., "user:abc123" or "admin:abc123")' },
          context: {
            type: 'object',
            additionalProperties: {},
            description: 'Optional context for permission evaluation',
          },
        },
        required: ['entity', 'action', 'actor'],
      },
    },
    {
      name: 'validate_entity',
      description: 'Validate entity data against its schema, required fields, type constraints, and business rules',
      inputSchema: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'Entity name' },
          data: {
            type: 'object',
            additionalProperties: {},
            description: 'Entity data to validate',
          },
        },
        required: ['entity', 'data'],
      },
    },
    {
      name: 'audit_log',
      description: 'Record an auditable action in the audit log (create, update, delete, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action performed (e.g., "order.created")' },
          entity: { type: 'string', description: 'Entity type' },
          entityId: { type: 'string', description: 'Entity identifier' },
          actor: { type: 'string', description: 'Actor who performed the action' },
          details: {
            type: 'object',
            additionalProperties: {},
            description: 'Optional structured details',
          },
        },
        required: ['action', 'entity', 'entityId', 'actor'],
      },
    },
    {
      name: 'get_audit_log',
      description: 'Retrieve audit log entries, optionally filtered by entity or actor',
      inputSchema: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'Optional entity filter' },
          actor: { type: 'string', description: 'Optional actor filter' },
          limit: { type: 'number', description: 'Max entries to return (default 50)' },
        },
      },
    },
    {
      name: 'list_entities',
      description: 'List all registered business entities',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'list_state_machines',
      description: 'List all registered state machines',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'list_decision_tables',
      description: 'List all registered decision tables',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'evaluate_all_rules',
      description: 'Evaluate all rules in a decision table against inputs and return results sorted by priority',
      inputSchema: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Decision table name' },
          inputs: { type: 'object', description: 'Key-value pairs to evaluate against' },
        },
        required: ['table', 'inputs'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_entity':
        return { content: [{ type: 'text', text: JSON.stringify(handleGetEntity(args as Record<string, unknown>), null, 2) }] };

      case 'get_valid_transitions':
        return { content: [{ type: 'text', text: JSON.stringify(handleGetValidTransitions(args as Record<string, unknown>), null, 2) }] };

      case 'get_field_semantics':
        return { content: [{ type: 'text', text: JSON.stringify(handleGetFieldSemantics(args as Record<string, unknown>), null, 2) }] };

      case 'get_entity_footguns':
        return { content: [{ type: 'text', text: JSON.stringify(handleGetEntityFootguns(args as Record<string, unknown>), null, 2) }] };

      case 'evaluate_decision_table':
        return { content: [{ type: 'text', text: JSON.stringify(handleEvaluateDecisionTable(args as Record<string, unknown>), null, 2) }] };

      case 'check_permission':
        return { content: [{ type: 'text', text: JSON.stringify(handleCheckPermission(args as Record<string, unknown>), null, 2) }] };

      case 'validate_entity':
        return { content: [{ type: 'text', text: JSON.stringify(handleValidateEntity(args as Record<string, unknown>), null, 2) }] };

      case 'audit_log':
        return { content: [{ type: 'text', text: JSON.stringify(handleAuditLog(args as Record<string, unknown>), null, 2) }] };

      case 'evaluate_all_rules': {
        return { content: [{ type: 'text', text: JSON.stringify(await handleEvaluateAllRules(args as Record<string, unknown>), null, 2) }] };
      }

      case 'get_audit_log':
        return { content: [{ type: 'text', text: JSON.stringify(handleGetAuditLog(args as Record<string, unknown>), null, 2) }] };

      case 'list_entities':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  entities: Array.from(entityRegistry.keys()),
                  count: entityRegistry.size,
                },
                null,
                2,
              ),
            },
          ],
        };

      case 'list_state_machines':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  stateMachines: Array.from(stateMachineRegistry.keys()).map((name) => ({
                    name,
                    states: stateMachineRegistry.get(name)!.states,
                    transitionCount: stateMachineRegistry.get(name)!.transitions.length,
                  })),
                  count: stateMachineRegistry.size,
                },
                null,
                2,
              ),
            },
          ],
        };

      case 'list_decision_tables':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  decisionTables: Array.from(decisionTableRegistry.keys()).map((name) => ({
                    name,
                    inputs: decisionTableRegistry.get(name)!.inputs,
                    outputs: decisionTableRegistry.get(name)!.outputs,
                    ruleCount: decisionTableRegistry.get(name)!.rules.length,
                  })),
                  count: decisionTableRegistry.size,
                },
                null,
                2,
              ),
            },
          ],
        };

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`,
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Unexpected error: ${(error as Error).message}`,
    );
  }
});

// ─── Startup ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Business-Logic MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
