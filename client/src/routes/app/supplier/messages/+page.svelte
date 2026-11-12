<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

  let conversations = $state<any[]>([]);
  let activeId = $state('');
  let messages = $state<any[]>([]);
  let body = $state('');
  let loading = $state(true);
  let error = $state('');

  async function loadConversations() {
    loading = true;
    error = '';
    try {
      conversations = (await api('/api/v1/supplier-network/conversations')) || [];
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
    try {
      await api(`/api/v1/supplier-network/conversations/${activeId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: body.trim() })
      });
      body = '';
      await loadMessages(activeId);
      await loadConversations();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  onMount(loadConversations);
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('messages')} subtitle={$t('supplierMessagesSubtitle')} />
  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  {#if loading}
    <div class="grid gap-4 lg:grid-cols-[280px_1fr]" role="status" aria-busy="true" aria-label={$t('loading')}>
      <Skeleton class="h-64" />
      <Skeleton class="h-64" />
    </div>
  {:else}
    <div class="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside class="surface-card overflow-hidden" aria-label={$t('messages')}>
        {#if !conversations.length}
          <p class="p-4 text-sm text-muted" role="status">{$t('noConversations')}</p>
        {:else}
          <ul role="list">
            {#each conversations as c}
              <li>
                <button
                  type="button"
                  class={`block w-full border-b border-border px-3 py-3 text-start text-sm transition-colors ${
                    activeId === c.id ? 'bg-surface-muted font-medium text-ink' : 'text-ink hover:bg-surface-muted/60'
                  }`}
                  aria-current={activeId === c.id ? 'true' : undefined}
                  onclick={() => loadMessages(c.id)}
                >
                  <span class="font-medium">{c.shop?.name || 'Shop'}</span>
                  {#if c.unread}
                    <span class="ms-2 text-xs text-accent" aria-label={`${c.unread} unread`}>{c.unread}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </aside>
      <div class="surface-card flex min-h-[20rem] flex-col p-4">
        {#if !activeId}
          <p class="m-auto text-sm text-muted" role="status">{$t('selectConversation')}</p>
        {:else}
          <div class="mb-3 max-h-96 flex-1 space-y-2 overflow-y-auto" role="log" aria-live="polite">
            {#each messages as m}
              <div class="rounded-[var(--radius-ui)] bg-surface-muted p-3 text-sm">
                <p class="text-xs text-muted">
                  {m.senderName} · {m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}
                </p>
                <p class="mt-1 whitespace-pre-wrap text-ink">{m.body}</p>
              </div>
            {:else}
              <p class="text-sm text-muted">{$t('empty')}</p>
            {/each}
          </div>
          <label class="block text-sm" for="sup-msg"
            >Message
            <textarea id="sup-msg" class="input-field mt-1 w-full" rows="3" bind:value={body}></textarea>
          </label>
          <Button class="mt-2" variant="primary" onclick={send}>Send</Button>
        {/if}
      </div>
    </div>
  {/if}
</section>
