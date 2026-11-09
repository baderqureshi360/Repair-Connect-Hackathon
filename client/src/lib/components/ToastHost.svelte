<script lang="ts">
  import { toasts } from '$lib/stores/toast';

  const tone: Record<string, string> = {
    success: 'border-success bg-success-soft text-success',
    error: 'border-danger bg-danger-soft text-danger',
    warning: 'border-warning bg-warning-soft text-warning',
    info: 'border-info bg-info-soft text-info'
  };
</script>

<div
  class="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4"
  aria-live="polite"
  aria-relevant="additions"
>
  {#each $toasts as toast (toast.id)}
    <div
      class={`toast-enter pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-3 py-2 text-sm shadow-panel ${tone[toast.kind]}`}
      role="status"
    >
      <p class="flex-1">{toast.message}</p>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={() => toasts.dismiss(toast.id)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  {/each}
</div>
