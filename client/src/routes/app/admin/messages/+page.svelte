<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { selectedShopId } from '$lib/stores/shopContext';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let conversations = $state<any[]>([]);
  let activeId = $state('');
  let messages = $state<any[]>([]);
  let body = $state('');
  let internal = $state(false);
  let loading = $state(true);
  let error = $state('');

  async function loadConversations() {
    loading = true;
    error = '';
    try {
      const shopId = $selectedShopId || '';
      conversations = (await api(`/api/v1/supplier-network/conversations?shopId=${shopId}`)) || [];
      if (!activeId && conversations[0]) activeId = conversations[0].id;
      if (activeId) await loadMessages(activeId);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  async function loadMessages(id: string) {
    activeId = id;
    messages = (await api(`/api/v1/supplier-network/conversations/${id}/messages`)) || [];
  }

  async function send() {
    if (!activeId || !body.trim()) return;
    error = '';
    try {
      await api(`/api/v1/supplier-network/conversations/${activeId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: body.trim(),
          visibility: internal ? 'shop_internal' : 'participant_visible'
        })
      });
      body = '';
      internal = false;
      await loadMessages(activeId);
      await loadConversations();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  onMount(loadConversations);
</script>

<section class="space-y-4">
  <header>
    <h1 class="text-2xl font-semibold">{$t('messages')}</h1>
    <p class="text-sm text-muted">Shop–supplier conversations</p>
  </header>
  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else}
    <div class="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside class="rounded-lg border border-border" aria-label="Conversations">
        {#if !conversations.length}
          <p class="p-3 text-sm text-muted">{$t('noConversations')}</p>
        {:else}
          <ul>
            {#each conversations as c}
              <li>
                <button
                  type="button"
                  class={`block w-full border-b border-border px-3 py-2 text-left text-sm ${activeId === c.id ? 'bg-surface-elevated' : ''}`}
                  onclick={() => loadMessages(c.id)}
                >
                  <span class="font-medium">{c.supplier?.businessName || 'Supplier'}</span>
                  {#if c.unread}<span class="ml-2 text-xs text-accent">{c.unread}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </aside>
      <div class="rounded-lg border border-border p-3">
        {#if !activeId}
          <p class="text-sm text-muted">Select a conversation</p>
        {:else}
          <div class="mb-3 max-h-96 space-y-2 overflow-y-auto" role="log" aria-live="polite">
            {#each messages as m}
              <div class={`rounded p-2 text-sm ${m.visibility === 'shop_internal' ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-surface-elevated'}`}>
                <p class="text-xs text-muted">
                  {m.senderName} · {m.visibility === 'shop_internal' ? $t('internalNoteShopOnly') : m.senderRole}
                  · {m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}
                </p>
                <p class="mt-1 whitespace-pre-wrap">{m.body}</p>
              </div>
            {/each}
          </div>
          <label class="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={internal} /> {$t('internalNoteShopOnly')}
          </label>
          <label class="block text-sm" for="msg-body"
            >Message
            <textarea id="msg-body" class="input-field mt-1 w-full" rows="3" bind:value={body}></textarea>
          </label>
          <Button class="mt-2" variant="primary" onclick={send}>Send</Button>
        {/if}
      </div>
    </div>
  {/if}
</section>
