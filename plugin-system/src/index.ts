/**
 * CodeNexus Plugin System
 *
 * Fused from Tiz554's plugin architecture. Provides a PluginRegistry
 * class with dynamic loading, metadata management, a skill system
 * for keyword→handler routing, lazy loading with health checks,
 * and trigger-based event dispatch.
 *
 * ```ts
 * import { PluginRegistry } from '@codenexus/plugin-system';
 * const registry = PluginRegistry.create();
 *
 * registry.register({
 *   id: 'my-plugin',
 *   name: 'My Plugin',
 *   version: '1.0.0',
 *   description: 'Does something useful',
 *   author: 'me',
 *   entrypoint: './handler.js',
 *   dependencies: [],
 *   triggers: ['review.completed'],
 * });
 *
 * await registry.load('my-plugin');
 * registry.enable('my-plugin');
 * await registry.dispatch('review.completed', { pr: 42 });
 * ```
 */

import type {
  PluginMetadata,
  PluginInstance,
  PluginPermissions,
  Skill,
} from "../../shared/src/types.js";
import * as path from "node:path";

// ─── Re-exports ───────────────────────────────────────────────

export type {
  PluginMetadata,
  PluginInstance,
  PluginPermissions,
  Skill,
} from "../../shared/src/types.js";

// ─── Plugin Health Check ──────────────────────────────────────

export interface HealthStatus {
  pluginId: string;
  healthy: boolean;
  lastCheck: string;
  latency: number; // ms
  memoryUsage: number; // MB
  error?: string;
}

export interface PluginLifecycleHooks {
  onLoad?: (pluginId: string) => Promise<void>;
  onEnable?: (pluginId: string) => Promise<void>;
  onDisable?: (pluginId: string) => Promise<void>;
  onUnload?: (pluginId: string) => Promise<void>;
}

// ─── Trigger Handler ──────────────────────────────────────────

export type TriggerHandler = (
  triggerName: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;

export interface SkillHandler {
  (input: string, context?: Record<string, unknown>): Promise<unknown>;
  metadata?: Skill;
}

// ─── Plugin Loader Interface ──────────────────────────────────

export interface PluginLoader {
  load: (metadata: PluginMetadata) => Promise<PluginInstance>;
  unload: (instance: PluginInstance) => Promise<void>;
}

// ─── Plugin Registry Events ───────────────────────────────────

export type RegistryEvent =
  | "plugin:registered"
  | "plugin:loaded"
  | "plugin:unloaded"
  | "plugin:enabled"
  | "plugin:disabled"
  | "plugin:error"
  | "skill:registered"
  | "trigger:dispatched";

export type RegistryEventListener = (
  event: RegistryEvent,
  data: Record<string, unknown>,
) => void;

// ─── Configuration ────────────────────────────────────────────

export interface PluginRegistryConfig {
  /** Directory to scan for plugins (default: './plugins') */
  pluginDir?: string;
  /** Enable health check polling */
  healthCheckIntervalMs?: number;
  /** Maximum concurrent plugin loads */
  maxConcurrentLoads?: number;
  /** Whether to auto-enable plugins after loading */
  autoEnable?: boolean;
  /** Whether to enable verbose logging */
  verbose?: boolean;
}

// ─── PluginRegistry ───────────────────────────────────────────

export class PluginRegistry {
  private plugins = new Map<string, PluginInstance>();
  private skills = new Map<string, Skill>();
  private triggerHandlers = new Map<string, Map<string, TriggerHandler>>();
  private keywordIndex = new Map<string, Set<string>>(); // keyword → skillIds
  private loadQueue: string[] = [];
  private loading = false;
  private listeners = new Set<RegistryEventListener>();
  private healthCheckTimers = new Map<string, ReturnType<typeof setInterval>>();
  private loader: PluginLoader;
  private hooks: PluginLifecycleHooks;
  private config: Required<PluginRegistryConfig>;

  // ── Singleton ───────────────────────────────────────────

  private static instance: PluginRegistry | null = null;

  /**
   * Create or retrieve the global PluginRegistry singleton.
   */
  static create(config?: PluginRegistryConfig): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry(config);
    }
    return PluginRegistry.instance;
  }

  /**
   * Reset the singleton (useful for testing).
   */
  static reset(): void {
    PluginRegistry.instance = null;
  }

  // ── Constructor ─────────────────────────────────────────

  constructor(
    config?: PluginRegistryConfig,
    loader?: PluginLoader,
    hooks?: PluginLifecycleHooks,
  ) {
    this.config = {
      pluginDir: config?.pluginDir ?? "./plugins",
      healthCheckIntervalMs: config?.healthCheckIntervalMs ?? 60000,
      maxConcurrentLoads: config?.maxConcurrentLoads ?? 5,
      autoEnable: config?.autoEnable ?? true,
      verbose: config?.verbose ?? false,
    };

    this.loader = loader ?? this.createDefaultLoader();
    this.hooks = hooks ?? {};

    this.log("PluginRegistry initialized");
  }

  // ── Plugin Lifecycle ────────────────────────────────────

  /**
   * Register a plugin's metadata. Does not load the plugin.
   */
  async register(metadata: PluginMetadata, authToken?: string, opts?: { permissions?: PluginPermissions }): Promise<PluginInstance> {
    if (authToken) {
      try {
        const { jwtVerify } = await import('jose');
        const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET || '');
        await jwtVerify(authToken, secret, { algorithms: ['HS256'] });
      } catch {
        throw new Error('PluginRegistrationError: invalid authentication token');
      }
    }

    if (this.plugins.has(metadata.id)) {
      this.log(`Plugin "${metadata.id}" already registered`, "warn");
      return this.plugins.get(metadata.id)!;
    }

    // Validate metadata
    this.validateMetadata(metadata);

    const instance: PluginInstance = {
      metadata,
      enabled: false,
      loaded: false,
      instance: null,
      permissions: opts?.permissions,
    };

    if (opts?.permissions) {
      const perm = opts.permissions;
      if (perm.filesystem?.read?.length) console.log(`[PluginRegistry] Plugin "${metadata.id}" granted FS read: ${perm.filesystem.read.join(', ')}`);
      if (perm.network?.allowOutbound?.length) console.log(`[PluginRegistry] Plugin "${metadata.id}" granted network: ${perm.network.allowOutbound.join(', ')}`);
    }

    this.plugins.set(metadata.id, instance);
    this.emit("plugin:registered", { pluginId: metadata.id, metadata });
    this.log(`Registered plugin "${metadata.id}" v${metadata.version}`);
    return instance;
  }

  /**
   * Unregister a plugin. Disables and unloads it first if active.
   */
  unregister(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      this.log(`Plugin "${pluginId}" not found`, "warn");
      return false;
    }

    if (plugin.enabled) {
      this.disable(pluginId);
    }
    if (plugin.loaded) {
      this.unload(pluginId);
    }

    this.plugins.delete(pluginId);

    // Clean up triggers
    this.triggerHandlers.delete(pluginId);

    // Clean up skills
    for (const [skillId, skill] of this.skills) {
      if (skill.pluginId === pluginId) {
        this.skills.delete(skillId);
        // Clean up keyword index
        for (const keyword of skill.keywords) {
          this.keywordIndex.get(keyword)?.delete(skillId);
          if (this.keywordIndex.get(keyword)?.size === 0) {
            this.keywordIndex.delete(keyword);
          }
        }
      }
    }

    this.stopHealthChecks(pluginId);
    this.emit("plugin:unloaded", { pluginId });
    this.log(`Unregistered plugin "${pluginId}"`);
    return true;
  }

  /**
   * Load a plugin's runtime instance (lazy loading).
   */
  async load(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginError(
        `Plugin "${pluginId}" is not registered`,
        "NOT_REGISTERED",
      );
    }
    if (plugin.loaded) {
      this.log(`Plugin "${pluginId}" already loaded`, "info");
      return true;
    }

    // Check dependencies
    const missing = plugin.metadata.dependencies.filter(
      (depId) => !this.plugins.has(depId) || !this.plugins.get(depId)!.loaded,
    );
    if (missing.length > 0) {
      throw new PluginError(
        `Plugin "${pluginId}" has unmet dependencies: ${missing.join(", ")}`,
        "MISSING_DEPENDENCIES",
      );
    }

    try {
      if (this.hooks.onLoad) {
        await this.hooks.onLoad(pluginId);
      }

      const instance = await this.loader.load(plugin.metadata);
      plugin.instance = instance.instance;
      plugin.loaded = true;

      this.emit("plugin:loaded", { pluginId });
      this.log(`Loaded plugin "${pluginId}"`);

      // Auto-enable if configured
      if (this.config.autoEnable) {
        this.enable(pluginId);
      }

      return true;
    } catch (err) {
      this.emit("plugin:error", { pluginId, error: String(err) });
      throw new PluginError(
        `Failed to load plugin "${pluginId}": ${err}`,
        "LOAD_FAILED",
      );
    }
  }

  /**
   * Unload a plugin's runtime instance.
   */
  async unload(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.loaded) {
      this.log(`Plugin "${pluginId}" is not loaded`, "info");
      return false;
    }

    if (plugin.enabled) {
      await this.disable(pluginId);
    }

    try {
      if (this.hooks.onUnload) {
        await this.hooks.onUnload(pluginId);
      }
      await this.loader.unload(plugin);
    } catch (err) {
      this.log(`Error unloading plugin "${pluginId}": ${err}`, "warn");
    }

    plugin.instance = null;
    plugin.loaded = false;
    this.stopHealthChecks(pluginId);
    this.emit("plugin:unloaded", { pluginId });
    this.log(`Unloaded plugin "${pluginId}"`);
    return true;
  }

  /**
   * Enable a loaded plugin (makes it active for dispatch).
   */
  async enable(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginError(`Plugin "${pluginId}" not found`, "NOT_FOUND");
    }
    if (!plugin.loaded) {
      throw new PluginError(`Plugin "${pluginId}" is not loaded`, "NOT_LOADED");
    }
    if (plugin.enabled) {
      return true;
    }

    try {
      if (this.hooks.onEnable) {
        await this.hooks.onEnable(pluginId);
      }
      plugin.enabled = true;
      this.startHealthChecks(pluginId);
      this.emit("plugin:enabled", { pluginId });
      this.log(`Enabled plugin "${pluginId}"`);
      return true;
    } catch (err) {
      this.emit("plugin:error", { pluginId, error: String(err) });
      throw new PluginError(
        `Failed to enable plugin "${pluginId}": ${err}`,
        "ENABLE_FAILED",
      );
    }
  }

  /**
   * Disable a plugin (stops dispatch but keeps it loaded).
   */
  async disable(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.enabled) {
      return false;
    }

    try {
      if (this.hooks.onDisable) {
        await this.hooks.onDisable(pluginId);
      }
      plugin.enabled = false;
      this.stopHealthChecks(pluginId);
      this.emit("plugin:disabled", { pluginId });
      this.log(`Disabled plugin "${pluginId}"`);
      return true;
    } catch (err) {
      this.emit("plugin:error", { pluginId, error: String(err) });
      throw new PluginError(
        `Failed to disable plugin "${pluginId}": ${err}`,
        "DISABLE_FAILED",
      );
    }
  }

  // ── Skills (keyword → handler routing) ─────────────────

  /**
   * Register a skill (keyword-driven handler).
   */
  registerSkill(skill: Skill): boolean {
    if (this.skills.has(skill.id)) {
      this.log(`Skill "${skill.id}" already registered`, "warn");
      return false;
    }

    // Verify plugin is registered
    if (!this.plugins.has(skill.pluginId)) {
      throw new PluginError(
        `Plugin "${skill.pluginId}" not registered for skill "${skill.id}"`,
        "PLUGIN_NOT_FOUND",
      );
    }

    this.skills.set(skill.id, skill);

    // Index keywords
    for (const keyword of skill.keywords) {
      const normalized = keyword.toLowerCase().trim();
      if (!this.keywordIndex.has(normalized)) {
        this.keywordIndex.set(normalized, new Set());
      }
      this.keywordIndex.get(normalized)!.add(skill.id);
    }

    this.emit("skill:registered", {
      skillId: skill.id,
      pluginId: skill.pluginId,
    });
    this.log(`Registered skill "${skill.id}" for plugin "${skill.pluginId}"`);
    return true;
  }

  /**
   * Unregister a skill.
   */
  unregisterSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    // Remove from keyword index
    for (const keyword of skill.keywords) {
      const normalized = keyword.toLowerCase().trim();
      this.keywordIndex.get(normalized)?.delete(skillId);
      if (this.keywordIndex.get(normalized)?.size === 0) {
        this.keywordIndex.delete(normalized);
      }
    }

    this.skills.delete(skillId);
    this.log(`Unregistered skill "${skillId}"`);
    return true;
  }

  /**
   * Find skills matching a natural language input by keyword analysis.
   */
  findSkills(input: string): Skill[] {
    const normalizedInput = input.toLowerCase();
    const matchedSkillIds = new Set<string>();

    // Direct keyword matching
    for (const [keyword, skillIds] of this.keywordIndex.entries()) {
      if (normalizedInput.includes(keyword)) {
        for (const skillId of skillIds) {
          matchedSkillIds.add(skillId);
        }
      }
    }

    // Fuzzy matching for partial keyword overlap
    for (const [keyword, skillIds] of this.keywordIndex.entries()) {
      const keywordParts = keyword.split(/[\s_-]+/);
      const matchedParts = keywordParts.filter(
        (part) => normalizedInput.includes(part) && part.length > 2,
      );
      if (matchedParts.length >= Math.ceil(keywordParts.length / 2)) {
        for (const skillId of skillIds) {
          matchedSkillIds.add(skillId);
        }
      }
    }

    return Array.from(matchedSkillIds)
      .map((id) => this.skills.get(id)!)
      .filter((skill) => {
        const plugin = this.plugins.get(skill.pluginId);
        return plugin?.enabled === true;
      });
  }

  /**
   * Execute a skill by its ID with input.
   */
  async executeSkill(
    skillId: string,
    input: string,
    context?: Record<string, unknown>,
  ): Promise<unknown> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new PluginError(`Skill "${skillId}" not found`, "SKILL_NOT_FOUND");
    }

    const plugin = this.plugins.get(skill.pluginId);
    if (!plugin?.enabled) {
      throw new PluginError(
        `Plugin "${skill.pluginId}" for skill "${skillId}" is not enabled`,
        "PLUGIN_NOT_ENABLED",
      );
    }

    // Execute the skill via the plugin instance
    const instance = plugin.instance as Record<string, unknown> | null;
    if (!instance || typeof instance[skill.handler] !== "function") {
      throw new PluginError(
        `Skill handler "${skill.handler}" not found on plugin "${skill.pluginId}"`,
        "HANDLER_NOT_FOUND",
      );
    }

    const handler = instance[skill.handler] as SkillHandler;
    return handler(input, context);
  }

  // ── Trigger System ─────────────────────────────────────

  /**
   * Register a trigger handler for a plugin.
   */
  onTrigger(
    pluginId: string,
    triggerName: string,
    handler: TriggerHandler,
  ): boolean {
    if (!this.plugins.has(pluginId)) {
      throw new PluginError(
        `Plugin "${pluginId}" not registered`,
        "NOT_REGISTERED",
      );
    }

    if (!this.triggerHandlers.has(triggerName)) {
      this.triggerHandlers.set(triggerName, new Map());
    }
    this.triggerHandlers.get(triggerName)!.set(pluginId, handler);
    return true;
  }

  /**
   * Dispatch a trigger event to all registered handlers.
   */
  async dispatch(
    triggerName: string,
    payload: Record<string, unknown>,
  ): Promise<Array<{ pluginId: string; result: unknown; error?: string }>> {
    const results: Array<{
      pluginId: string;
      result: unknown;
      error?: string;
    }> = [];

    // Find all plugins that have this trigger
    for (const [pluginId, plugin] of this.plugins) {
      if (!plugin.enabled || !plugin.loaded) continue;

      if (!plugin.metadata.triggers.includes(triggerName)) continue;

      // Check permissions before dispatch — block if violated
      if (plugin.permissions) {
        const perm = plugin.permissions;
        if (!perm.network?.allowOutbound?.length && payload && typeof payload === 'object' && ('url' in payload || 'domain' in payload)) {
          results.push({ pluginId, result: null, error: `Plugin "${pluginId}" attempted network access without permission` });
          continue;
        }
        if (!perm.filesystem?.write?.length && payload && typeof payload === 'object' && 'filePath' in payload) {
          results.push({ pluginId, result: null, error: `Plugin "${pluginId}" attempted filesystem access without permission` });
          continue;
        }
      }

      try {
        const instance = plugin.instance as Record<string, unknown> | null;
        if (
          instance &&
          typeof instance[`on${this.capitalize(triggerName)}`] === "function"
        ) {
          const handler = instance[
            `on${this.capitalize(triggerName)}`
          ] as TriggerHandler;
          const result = await handler(triggerName, payload);
          results.push({ pluginId, result });
        }
      } catch (err) {
        const error = String(err);
        results.push({ pluginId, result: null, error });
        this.emit("plugin:error", { pluginId, triggerName, error });
      }
    }

    this.emit("trigger:dispatched", {
      triggerName,
      pluginCount: results.length,
    });
    return results;
  }

  /**
   * Dispatch a trigger event to a specific plugin only.
   */
  async dispatchTo(
    pluginId: string,
    triggerName: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.enabled || !plugin.loaded) {
      throw new PluginError(
        `Plugin "${pluginId}" is not available for dispatch`,
        "PLUGIN_NOT_AVAILABLE",
      );
    }

    if (!plugin.metadata.triggers.includes(triggerName)) {
      throw new PluginError(
        `Plugin "${pluginId}" does not handle trigger "${triggerName}"`,
        "TRIGGER_NOT_HANDLED",
      );
    }

    // Check permissions before dispatch — block if violated
    if (plugin.permissions) {
      const perm = plugin.permissions;
      if (!perm.network?.allowOutbound?.length && payload && typeof payload === 'object' && ('url' in payload || 'domain' in payload)) {
        throw new PluginError(
          `Plugin "${pluginId}" attempted network access without permission`,
          "PERMISSION_DENIED",
          pluginId,
        );
      }
      if (!perm.filesystem?.write?.length && payload && typeof payload === 'object' && 'filePath' in payload) {
        throw new PluginError(
          `Plugin "${pluginId}" attempted filesystem access without permission`,
          "PERMISSION_DENIED",
          pluginId,
        );
      }
    }

    const instance = plugin.instance as Record<string, unknown> | null;
    if (
      instance &&
      typeof instance[`on${this.capitalize(triggerName)}`] === "function"
    ) {
      const handler = instance[
        `on${this.capitalize(triggerName)}`
      ] as TriggerHandler;
      return handler(triggerName, payload);
    }

    return null;
  }

  // ── Health Checks ──────────────────────────────────────

  /**
   * Get health status for a specific plugin.
   */
  async getHealth(pluginId: string): Promise<HealthStatus> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginError(`Plugin "${pluginId}" not found`, "NOT_FOUND");
    }

    const startTime = Date.now();

    try {
      const instance = plugin.instance as Record<string, unknown> | null;
      if (instance && typeof instance.healthCheck === "function") {
        await (instance.healthCheck as () => Promise<void>)();
      }

      const latency = Date.now() - startTime;
      return {
        pluginId,
        healthy: true,
        lastCheck: new Date().toISOString(),
        latency,
        memoryUsage:
          Math.round(process.memoryUsage?.()?.heapUsed / 1024 / 1024) ?? 0,
      };
    } catch (err) {
      return {
        pluginId,
        healthy: false,
        lastCheck: new Date().toISOString(),
        latency: Date.now() - startTime,
        memoryUsage: 0,
        error: String(err),
      };
    }
  }

  /**
   * Run health checks on all enabled plugins.
   */
  async healthCheckAll(): Promise<HealthStatus[]> {
    const results: HealthStatus[] = [];
    for (const [pluginId, plugin] of this.plugins) {
      if (plugin.enabled) {
        results.push(await this.getHealth(pluginId));
      }
    }
    return results;
  }

  // ── Query Methods ──────────────────────────────────────

  /**
   * Get all registered plugins.
   */
  getPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a specific plugin by ID.
   */
  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get all registered skills.
   */
  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get all skills for a specific plugin.
   */
  getPluginSkills(pluginId: string): Skill[] {
    return Array.from(this.skills.values()).filter(
      (s) => s.pluginId === pluginId,
    );
  }

  /**
   * Check if a plugin is registered.
   */
  isRegistered(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Check if a plugin is loaded.
   */
  isLoaded(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.loaded === true;
  }

  /**
   * Check if a plugin is enabled.
   */
  isEnabled(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.enabled === true;
  }

  /**
   * Get capability summary for all registered plugins.
   */
  getCapabilities(): { totalPlugins: number; sandboxedPlugins: number; capabilities: { id: string; permissions: PluginPermissions | null }[] } {
    const capabilities = [...this.plugins.entries()].map(([id, instance]) => ({
      id,
      permissions: instance.permissions || null,
    }));
    return {
      totalPlugins: this.plugins.size,
      sandboxedPlugins: capabilities.filter(c => c.permissions !== null).length,
      capabilities,
    };
  }

  // ── Event System ───────────────────────────────────────

  /**
   * Subscribe to registry events.
   */
  onEvent(listener: RegistryEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Load all plugins from the configured plugin directory.
   */
  async loadAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const plugins = this.getPlugins();

    for (const plugin of plugins) {
      try {
        const loaded = await this.load(plugin.metadata.id);
        results.set(plugin.metadata.id, loaded);
      } catch (err) {
        this.log(
          `Failed to load plugin "${plugin.metadata.id}": ${err}`,
          "warn",
        );
        results.set(plugin.metadata.id, false);
      }
    }

    return results;
  }

  // ── Private Methods ────────────────────────────────────

  private validateMetadata(metadata: PluginMetadata): void {
    if (!metadata.id || !/^[a-z0-9_-]+$/i.test(metadata.id)) {
      throw new PluginError(
        `Invalid plugin ID "${metadata.id}". Must match [a-z0-9_-]+`,
        "INVALID_METADATA",
      );
    }
    if (!metadata.name) {
      throw new PluginError("Plugin name is required", "INVALID_METADATA");
    }
    if (!metadata.version || !/^\d+\.\d+\.\d+$/.test(metadata.version)) {
      throw new PluginError(
        `Invalid version "${metadata.version}". Must be semver (x.y.z)`,
        "INVALID_METADATA",
      );
    }
    if (!Array.isArray(metadata.triggers)) {
      throw new PluginError(
        "Plugin triggers must be an array",
        "INVALID_METADATA",
      );
    }
    if (metadata.permissions && typeof metadata.permissions !== 'object') {
      throw new Error(`Plugin "${metadata.id}": permissions must be an object`);
    }
  }

  private startHealthChecks(pluginId: string): void {
    if (this.config.healthCheckIntervalMs <= 0) return;
    if (this.healthCheckTimers.has(pluginId)) return;

    const interval = Math.max(1000, this.config.healthCheckIntervalMs);
    const timer = setInterval(async () => {
      try {
        const status = await this.getHealth(pluginId);
        if (!status.healthy) {
          this.log(
            `Plugin "${pluginId}" health check failed: ${status.error}`,
            "warn",
          );
          this.emit("plugin:error", { pluginId, healthStatus: status });
        }
      } catch (err) {
        this.log(`Health check error for "${pluginId}": ${err}`, "warn");
      }
    }, interval);

    this.healthCheckTimers.set(pluginId, timer);
  }

  private stopHealthChecks(pluginId: string): void {
    const timer = this.healthCheckTimers.get(pluginId);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(pluginId);
    }
  }

  /** Shutdown all health check timers and clear the singleton. */
  shutdown(): void {
    for (const [pluginId] of this.healthCheckTimers) {
      this.stopHealthChecks(pluginId);
    }
    this.plugins.clear();
    this.skills.clear();
    this.listeners.clear();
  }

  private capitalize(str: string): string {
    return str
      .split(".")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }

  private emit(event: RegistryEvent, data: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (err) {
        // Don't let a listener crash the system
        console.error(`[plugins] Listener error on ${event}:`, err);
      }
    }
  }

  private log(message: string, level: "log" | "warn" | "info" = "log"): void {
    if (!this.config.verbose && level === "log") return;
    const prefix = "[plugins]";
    switch (level) {
      case "warn":
        console.warn(`${prefix} ${message}`);
        break;
      case "info":
        console.info(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }

  private createDefaultLoader(): PluginLoader {
    return {
      load: async (metadata: PluginMetadata): Promise<PluginInstance> => {
        const entrypoint = metadata.entrypoint;
        if (!entrypoint) {
          throw new PluginError(
            `Plugin "${metadata.id}" has no entrypoint`,
            'INVALID_ENTRYPOINT'
          );
        }
        // Restrict to plugins directory — block bare specifiers and node_modules access
        const PLUGIN_DIR = this.config.pluginDir;
        const pluginsDir = path.resolve(PLUGIN_DIR);
        const resolved = path.resolve(pluginsDir, entrypoint);

        // Block path traversal, absolute paths, and Windows drive letters
        if (
          entrypoint.includes('..') ||
          path.isAbsolute(entrypoint) ||
          /^[a-zA-Z]:[\\/]/.test(entrypoint)
        ) {
          throw new PluginError(
            `Plugin "${metadata.id}" entrypoint must be a relative path under ${PLUGIN_DIR} (got: "${entrypoint}")`,
            'INVALID_ENTRYPOINT'
          );
        }

        // Block bare specifiers (e.g. 'child_process', 'fs') and node_modules access
        if (!entrypoint.includes('/') && !entrypoint.includes('\\')) {
          throw new PluginError(
            `Plugin "${metadata.id}" entrypoint must be a relative path, not a bare module specifier (got: "${entrypoint}")`,
            'INVALID_ENTRYPOINT'
          );
        }

        // Must be under the plugins directory
        if (!resolved.startsWith(pluginsDir + path.sep) && resolved !== pluginsDir) {
          throw new PluginError(
            `Plugin "${metadata.id}" entrypoint must be under ${PLUGIN_DIR} directory (got: "${entrypoint}")`,
            'INVALID_ENTRYPOINT'
          );
        }

        // Only allow recognized extensions
        if (!/\.(js|ts|mjs|cjs)$/i.test(entrypoint)) {
          throw new PluginError(
            `Plugin "${metadata.id}" entrypoint must have .js/.ts/.mjs/.cjs extension (got: "${entrypoint}")`,
            'INVALID_ENTRYPOINT'
          );
        }

        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          const mod = require(entrypoint);
          return {
            metadata,
            enabled: false,
            loaded: true,
            instance: mod.default ?? mod,
          };
        } catch (err) {
          this.log(
            `Default loader could not load "${entrypoint}": ${err}`,
            "warn",
          );
          throw new PluginError(
            `Failed to load plugin "${metadata.id}": ${(err as Error).message}`,
            'LOAD_FAILED'
          );
        }
      },
      unload: async (_instance: PluginInstance): Promise<void> => {},
    };
  }
}

// ─── PluginError ──────────────────────────────────────────────

export class PluginError extends Error {
  public code: string;
  public pluginId?: string;

  constructor(message: string, code: string, pluginId?: string) {
    super(message);
    this.name = "PluginError";
    this.code = code;
    this.pluginId = pluginId;
  }
}

// ─── Default Export ───────────────────────────────────────────

export default PluginRegistry;
