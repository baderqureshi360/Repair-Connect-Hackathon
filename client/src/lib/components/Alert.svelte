<script lang="ts">
  let {
    type = 'info',
    message,
    role = 'status'
  }: { type?: 'info' | 'error' | 'success' | 'warning'; message: string; role?: 'status' | 'alert' } =
    $props();

  const typeClass = $derived(
    type === 'error'
      ? 'alert-error'
      : type === 'success'
        ? 'alert-success'
        : type === 'warning'
          ? 'alert-warning'
          : 'alert-info'
  );
</script>

<div
  class={`alert ${typeClass}`}
  {role}
  aria-live={role === 'alert' ? 'assertive' : 'polite'}
>
  {message}
</div>
