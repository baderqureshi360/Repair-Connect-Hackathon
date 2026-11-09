<script lang="ts">
  let {
    type = 'info',
    message,
    role = 'status'
  }: { type?: 'info' | 'error' | 'success' | 'warning'; message: string; role?: 'status' | 'alert' } =
    $props();
</script>

<div
  class="rounded-md border px-3 py-2 text-sm"
  class:border-red-300={type === 'error'}
  class:bg-red-50={type === 'error'}
  class:dark:bg-red-950={type === 'error'}
  class:border-emerald-300={type === 'success'}
  class:bg-emerald-50={type === 'success'}
  class:border-amber-300={type === 'warning'}
  class:bg-amber-50={type === 'warning'}
  class:border-sky-300={type === 'info'}
  class:bg-sky-50={type === 'info'}
  {role}
  aria-live={role === 'alert' ? 'assertive' : 'polite'}
>
  {message}
</div>
