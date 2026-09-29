import { createClient } from '../helpers/client.js';
import { getSharedEnv } from './sharedEnv.js';

describe('Tab Lifecycle', () => {
  let serverUrl;
  let testSiteUrl;
  
  beforeAll(() => {
    const env = getSharedEnv();
    serverUrl = env.serverUrl;
    testSiteUrl = env.testSiteUrl;
  });
  
  // Server lifecycle managed by globalSetup/globalTeardown
  
  test('health check returns camoufox engine', async () => {
    const client = createClient(serverUrl);
    const health = await client.health();
    
    expect(health.ok).toBe(true);
    expect(health.engine).toBe('camoufox');
  });
  
  test('exports and checkpoints session cookies for silent reauthentication', async () => {
    const client = createClient(serverUrl);
    try {
      const response = await fetch(`${serverUrl}/sessions/${client.userId}/storage_state`);
      expect(response.status).toBe(200);
      expect((await response.json()).cookies).toEqual([]);
      await client.request('POST', `/sessions/${client.userId}/cookies`, {
        cookies: [{ name: 'receipt_session', value: 'test-only', domain: 'example.test', path: '/', httpOnly: true }],
      });
      const state = await client.request('GET', `/sessions/${client.userId}/storage_state`);
      expect(state.cookies).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'receipt_session', value: 'test-only', httpOnly: true }),
      ]));
    } finally {
      await client.cleanup();
    }
  });

  test('create tab without URL', async () => {
    const client = createClient(serverUrl);
    
    try {
      const result = await client.createTab();
      
      expect(result.tabId).toBeDefined();
      expect(typeof result.tabId).toBe('string');
      expect(result.url).toBe('about:blank');
    } finally {
      await client.cleanup();
    }
  });
  
  test('create tab with URL', async () => {
    const client = createClient(serverUrl);
    
    try {
      const result = await client.createTab(`${testSiteUrl}/pageA`);
      
      expect(result.tabId).toBeDefined();
      expect(result.url).toContain('/pageA');
      
      const snapshot = await client.getSnapshot(result.tabId);
      expect(snapshot.snapshot).toContain('Page A');
    } finally {
      await client.cleanup();
    }
  });
  
  test('create multiple tabs in same group', async () => {
    const client = createClient(serverUrl);
    
    try {
      const tab1 = await client.createTab(`${testSiteUrl}/pageA`);
      const tab2 = await client.createTab(`${testSiteUrl}/pageB`);
      
      expect(tab1.tabId).not.toBe(tab2.tabId);
      
      const snapshot1 = await client.getSnapshot(tab1.tabId);
      const snapshot2 = await client.getSnapshot(tab2.tabId);
      
      expect(snapshot1.snapshot).toContain('Page A');
      expect(snapshot2.snapshot).toContain('Page B');
    } finally {
      await client.cleanup();
    }
  });
  
  test('close individual tab', async () => {
    const client = createClient(serverUrl);
    
    try {
      const tab1 = await client.createTab(`${testSiteUrl}/pageA`);
      const tab2 = await client.createTab(`${testSiteUrl}/pageB`);
      
      await client.closeTab(tab1.tabId);
      
      // Tab 1 should be gone
      await expect(client.getSnapshot(tab1.tabId)).rejects.toThrow();
      
      // Tab 2 should still work
      const snapshot2 = await client.getSnapshot(tab2.tabId);
      expect(snapshot2.snapshot).toContain('Page B');
    } finally {
      await client.cleanup();
    }
  });
  
  test('close tab group', async () => {
    const client = createClient(serverUrl);
    
    try {
      const tab1 = await client.createTab(`${testSiteUrl}/pageA`);
      const tab2 = await client.createTab(`${testSiteUrl}/pageB`);
      
      await client.closeTabGroup();
      
      // Both tabs should be gone
      await expect(client.getSnapshot(tab1.tabId)).rejects.toThrow();
      await expect(client.getSnapshot(tab2.tabId)).rejects.toThrow();
    } finally {
      await client.cleanup();
    }
  });
  
  test('close session clears all tabs', async () => {
    const client = createClient(serverUrl);
    
    const tab = await client.createTab(`${testSiteUrl}/pageA`);
    
    await client.closeSession();
    
    // Tab should be gone after session close
    await expect(client.getSnapshot(tab.tabId)).rejects.toThrow();
  });
  
  test('tab stats are tracked correctly', async () => {
    const client = createClient(serverUrl);
    
    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/pageA`);
      
      // Make some operations
      await client.getSnapshot(tabId);
      await client.navigate(tabId, `${testSiteUrl}/pageB`);
      await client.getSnapshot(tabId);
      
      const stats = await client.getStats(tabId);
      
      expect(stats.tabId).toBe(tabId);
      expect(stats.sessionKey).toBe(client.sessionKey);
      expect(stats.url).toContain('/pageB');
      expect(stats.toolCalls).toBeGreaterThan(0);
      expect(stats.visitedUrls).toContain(`${testSiteUrl}/pageA`);
    } finally {
      await client.cleanup();
    }
  });
});
