<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import { selectedShopId } from '$lib/stores/shopContext';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  type StaffRole = 'mechanic' | 'parts_coordinator' | 'shop_admin';
  type StaffRow = {
    id: string;
    membershipId: string;
    role: StaffRole;
    isActive: boolean;
    createdAt?: string;
    user: {
      id?: string;
      _id?: string;
      name: string;
      email: string;
      phone?: string;
      isActive?: boolean;
      preferredLanguage?: string;
    } | null;
    shop: { id?: string; _id?: string; name?: string; code?: string } | null;
  };

  let loading = $state(true);
  let error = $state('');
  let message = $state('');
  let tempPassword = $state('');
  let staff = $state<StaffRow[]>([]);
  let stats = $state({
    total: 0,
    active: 0,
    inactive: 0,
    byRole: { shop_admin: 0, mechanic: 0, parts_coordinator: 0 }
  });
  let shops = $state<{ id: string; name: string }[]>([]);
  let roleFilter = $state<'all' | StaffRole>('all');
  let statusFilter = $state<'all' | 'active' | 'inactive'>('all');
  let query = $state('');

  let showCreate = $state(false);
  let editing = $state<StaffRow | null>(null);
  let viewing = $state<StaffRow | null>(null);

  let createForm = $state({
    name: '',
    email: '',
    phone: '',
    role: 'mechanic' as StaffRole,
    shopId: '',
    password: '',
    invite: true
  });

  let editForm = $state({
    name: '',
    phone: '',
    role: 'mechanic' as StaffRole,
    shopId: '',
    preferredLanguage: 'en' as 'en' | 'ur'
  });

  const kpiStats = $derived([
    { label: $t('totalStaff'), value: stats.total, icon: 'users', tone: 'indigo' as const },
    { label: $t('activeStaff'), value: stats.active, icon: 'users', tone: 'green' as const },
    { label: $t('inactiveStaff'), value: stats.inactive, icon: 'users', tone: 'amber' as const },
    {
      label: $t('staffByRole'),
      value: `${stats.byRole.shop_admin}/${stats.byRole.mechanic}/${stats.byRole.parts_coordinator}`,
      hint: `${$t('shop_admin')} / ${$t('mechanic')} / ${$t('parts_coordinator')}`,
      icon: 'users',
      tone: 'violet' as const
    }
  ]);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((row) => {
      if (roleFilter !== 'all' && row.role !== roleFilter) return false;
      if (statusFilter === 'active' && !row.isActive) return false;
      if (statusFilter === 'inactive' && row.isActive) return false;
      if (!q) return true;
      const hay = [row.user?.name, row.user?.email, row.user?.phone, row.role, row.shop?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  });

  function formatDate(value?: string) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '—';
    }
  }

  function roleLabel(role: string) {
    if (role === 'shop_admin') return $t('shop_admin');
    if (role === 'mechanic') return $t('mechanic');
    if (role === 'parts_coordinator') return $t('parts_coordinator');
    return role;
  }

  function isSelf(row: StaffRow) {
    const id = row.user?.id || row.user?._id;
    return Boolean($user?.id && id && String(id) === String($user.id));
  }

  async function loadShops() {
    const list = (await api<any[]>('/api/v1/shops/mine')) || [];
    shops = list
      .map((s) => ({ id: String(s._id || s.id), name: s.name || s.code || 'Shop' }))
      .filter((s) => s.id);
    if (!createForm.shopId && ($selectedShopId || shops[0]?.id)) {
      createForm.shopId = $selectedShopId || shops[0].id;
    }
  }

  async function load() {
    loading = true;
    error = '';
    try {
      await loadShops();
      const params = new URLSearchParams({ view: 'manage', includeInactive: '1' });
      if ($selectedShopId) params.set('shopId', $selectedShopId);
      const data = await api<{
        staff: StaffRow[];
        stats: typeof stats;
      }>(`/api/v1/auth/staff?${params.toString()}`);
      staff = data?.staff || [];
      stats = data?.stats || stats;
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  let shopWatcherReady = $state(false);

  onMount(async () => {
    if ($user && $user.role !== 'shop_admin') {
      const dest =
        $user.role === 'parts_coordinator'
          ? '/app/parts'
          : $user.role === 'mechanic'
            ? '/app/mechanic'
            : $user.role === 'platform_operator'
              ? '/app/platform/shop-applications'
              : '/app/customer';
      await goto(dest);
      return;
    }
    await load();
    shopWatcherReady = true;
  });

  $effect(() => {
    const shopId = $selectedShopId;
    if (!shopWatcherReady) return;
    void shopId;
    load();
  });

  async function createStaff() {
    error = '';
    message = '';
    tempPassword = '';
    try {
      const created = await api<{
        user: { role: string };
        invite?: { resetToken?: string };
      }>('/api/v1/auth/staff', {
        method: 'POST',
        body: JSON.stringify(createForm)
      });
      message = $t('staffCreated');
      if (createForm.password) tempPassword = createForm.password;
      showCreate = false;
      createForm = {
        name: '',
        email: '',
        phone: '',
        role: 'mechanic',
        shopId: $selectedShopId || shops[0]?.id || '',
        password: '',
        invite: true
      };
      await load();
      if (created?.user?.role === 'parts_coordinator') {
        message = `${$t('staffCreated')} → ${$t('parts_coordinator')}`;
      }
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  function openEdit(row: StaffRow) {
    editing = row;
    editForm = {
      name: row.user?.name || '',
      phone: row.user?.phone || '',
      role: row.role,
      shopId: String(row.shop?.id || row.shop?._id || ''),
      preferredLanguage: (row.user?.preferredLanguage as 'en' | 'ur') || 'en'
    };
  }

  async function saveEdit() {
    if (!editing) return;
    error = '';
    message = '';
    try {
      await api(`/api/v1/auth/staff/${editing.membershipId || editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm)
      });
      message = $t('staffUpdated');
      editing = null;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function setActive(row: StaffRow, isActive: boolean) {
    if (isSelf(row) && !isActive) {
      error = $t('cannotManageSelf');
      return;
    }
    if (!isActive && !confirm($t('confirmDeactivateStaff'))) return;
    error = '';
    message = '';
    try {
      await api(`/api/v1/auth/staff/${row.membershipId || row.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ isActive })
      });
      message = isActive ? $t('staffActivated') : $t('staffDeactivated');
      viewing = null;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function resetPassword(row: StaffRow) {
    error = '';
    message = '';
    tempPassword = '';
    try {
      const result = await api<{ temporaryPassword: string }>(
        `/api/v1/auth/staff/${row.membershipId || row.id}/reset-password`,
        {
          method: 'POST',
          body: JSON.stringify({ invite: true })
        }
      );
      tempPassword = result.temporaryPassword || '';
      message = $t('passwordResetDone');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="space-y-4" data-testid="staff-management">
  <PageHeader title={$t('staff')} subtitle={$t('staffSubtitle')}>
    <Button data-testid="add-staff" onclick={() => (showCreate = true)}>{$t('addStaff')}</Button>
  </PageHeader>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if message}<Alert type="success" message={message} />{/if}
  {#if tempPassword}
    <Alert
      type="info"
      message={`${$t('temporaryPasswordIssued')}: ${tempPassword}`}
      role="status"
    />
  {/if}

  {#if loading}
    <Skeleton lines={6} />
  {:else}
    <StatGrid stats={kpiStats} />

    <div class="flex flex-wrap items-end gap-3">
      <label class="text-sm">
        <span class="mb-1 block text-muted">{$t('search')}</span>
        <input
          class="input-field min-w-[14rem]"
          type="search"
          placeholder={$t('searchStaff')}
          bind:value={query}
          data-testid="staff-search"
        />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-muted">{$t('filterByRole')}</span>
        <select class="input-field" bind:value={roleFilter} data-testid="staff-role-filter">
          <option value="all">{$t('all')}</option>
          <option value="shop_admin">{$t('shop_admin')}</option>
          <option value="mechanic">{$t('mechanic')}</option>
          <option value="parts_coordinator">{$t('parts_coordinator')}</option>
        </select>
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-muted">{$t('filterByStatus')}</span>
        <select class="input-field" bind:value={statusFilter} data-testid="staff-status-filter">
          <option value="all">{$t('all')}</option>
          <option value="active">{$t('statusActive')}</option>
          <option value="inactive">{$t('statusInactive')}</option>
        </select>
      </label>
      <p class="pb-2 text-xs text-muted" aria-live="polite">{filtered.length} {$t('results')}</p>
    </div>

    <div class="overflow-x-auto rounded-xl border border-border bg-surface-elevated">
      <table class="min-w-full text-sm">
        <caption class="sr-only">{$t('staff')}</caption>
        <thead>
          <tr class="border-b border-border text-start text-muted">
            <th scope="col" class="px-4 py-3 font-medium">{$t('name')}</th>
            <th scope="col" class="px-4 py-3 font-medium">{$t('email')}</th>
            <th scope="col" class="px-4 py-3 font-medium">{$t('role')}</th>
            <th scope="col" class="px-4 py-3 font-medium">{$t('assignedShop')}</th>
            <th scope="col" class="px-4 py-3 font-medium">{$t('accountStatus')}</th>
            <th scope="col" class="px-4 py-3 font-medium">{$t('dateAdded')}</th>
            <th scope="col" class="px-4 py-3 font-medium">{$t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as row}
            <tr class="border-b border-border last:border-0" data-testid="staff-row">
              <td class="px-4 py-3 font-medium">{row.user?.name || '—'}</td>
              <td class="px-4 py-3 text-muted">{row.user?.email || '—'}</td>
              <td class="px-4 py-3">{roleLabel(row.role)}</td>
              <td class="px-4 py-3">{row.shop?.name || '—'}</td>
              <td class="px-4 py-3">
                <StatusPill
                  status={row.isActive ? 'completed' : 'cancelled'}
                  label={row.isActive ? $t('statusActive') : $t('statusInactive')}
                />
              </td>
              <td class="px-4 py-3 text-muted">{formatDate(row.createdAt)}</td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onclick={() => (viewing = row)}>{$t('viewStaff')}</Button>
                  <Button size="sm" variant="secondary" onclick={() => openEdit(row)}>{$t('editStaff')}</Button>
                  {#if row.isActive}
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={isSelf(row)}
                      onclick={() => setActive(row, false)}>{$t('deactivateStaff')}</Button
                    >
                  {:else}
                    <Button size="sm" variant="primary" onclick={() => setActive(row, true)}
                      >{$t('activateStaff')}</Button
                    >
                  {/if}
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td class="px-4 py-6 text-muted" colspan="7">{$t('empty')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<Modal open={showCreate} title={$t('addStaff')} onclose={() => (showCreate = false)}>
  <form
    class="grid gap-3 sm:grid-cols-2"
    data-testid="add-staff-form"
    onsubmit={(e) => {
      e.preventDefault();
      createStaff();
    }}
  >
    <label class="text-sm"
      >{$t('name')}<input class="input-field mt-1" required minlength="2" bind:value={createForm.name} /></label
    >
    <label class="text-sm"
      >{$t('email')}<input class="input-field mt-1" type="email" required bind:value={createForm.email} /></label
    >
    <label class="text-sm"
      >{$t('phone')}<input class="input-field mt-1" bind:value={createForm.phone} /></label
    >
    <label class="text-sm"
      >{$t('role')}
      <select class="input-field mt-1" bind:value={createForm.role} required>
        <option value="mechanic">{$t('mechanic')}</option>
        <option value="parts_coordinator">{$t('parts_coordinator')}</option>
        <option value="shop_admin">{$t('shop_admin')}</option>
      </select>
    </label>
    <label class="text-sm sm:col-span-2"
      >{$t('assignedShop')}
      <select class="input-field mt-1" bind:value={createForm.shopId} required>
        {#each shops as shop}
          <option value={shop.id}>{shop.name}</option>
        {/each}
      </select>
    </label>
    <label class="text-sm sm:col-span-2"
      >{$t('initialPassword')}
      <input
        class="input-field mt-1"
        type="password"
        required
        minlength="8"
        autocomplete="new-password"
        bind:value={createForm.password}
      />
      <span class="mt-1 block text-xs text-muted">{$t('passwordStrengthHint')}</span>
    </label>
    <label class="inline-flex items-center gap-2 text-sm sm:col-span-2">
      <input type="checkbox" bind:checked={createForm.invite} />
      {$t('inviteWorkflow')}
    </label>
    <div class="flex justify-end gap-2 sm:col-span-2">
      <Button type="button" variant="outline" onclick={() => (showCreate = false)}>{$t('cancel')}</Button>
      <Button type="submit">{$t('addStaff')}</Button>
    </div>
  </form>
</Modal>

<Modal open={Boolean(editing)} title={$t('editStaff')} onclose={() => (editing = null)}>
  {#if editing}
    <form
      class="grid gap-3 sm:grid-cols-2"
      onsubmit={(e) => {
        e.preventDefault();
        saveEdit();
      }}
    >
      <label class="text-sm"
        >{$t('name')}<input class="input-field mt-1" required bind:value={editForm.name} /></label
      >
      <label class="text-sm"
        >{$t('phone')}<input class="input-field mt-1" bind:value={editForm.phone} /></label
      >
      <label class="text-sm"
        >{$t('role')}
        <select class="input-field mt-1" bind:value={editForm.role} disabled={isSelf(editing)}>
          <option value="mechanic">{$t('mechanic')}</option>
          <option value="parts_coordinator">{$t('parts_coordinator')}</option>
          <option value="shop_admin">{$t('shop_admin')}</option>
        </select>
      </label>
      <label class="text-sm"
        >{$t('assignedShop')}
        <select class="input-field mt-1" bind:value={editForm.shopId}>
          {#each shops as shop}
            <option value={shop.id}>{shop.name}</option>
          {/each}
        </select>
      </label>
      <div class="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="outline" onclick={() => (editing = null)}>{$t('cancel')}</Button>
        <Button type="submit">{$t('save')}</Button>
      </div>
    </form>
  {/if}
</Modal>

<Modal open={Boolean(viewing)} title={$t('viewStaff')} onclose={() => (viewing = null)}>
  {#if viewing}
    <dl class="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt class="text-muted">{$t('name')}</dt>
        <dd class="font-medium">{viewing.user?.name}</dd>
      </div>
      <div>
        <dt class="text-muted">{$t('email')}</dt>
        <dd>{viewing.user?.email}</dd>
      </div>
      <div>
        <dt class="text-muted">{$t('phone')}</dt>
        <dd>{viewing.user?.phone || '—'}</dd>
      </div>
      <div>
        <dt class="text-muted">{$t('role')}</dt>
        <dd>{roleLabel(viewing.role)}</dd>
      </div>
      <div>
        <dt class="text-muted">{$t('assignedShop')}</dt>
        <dd>{viewing.shop?.name || '—'}</dd>
      </div>
      <div>
        <dt class="text-muted">{$t('accountStatus')}</dt>
        <dd>{viewing.isActive ? $t('statusActive') : $t('statusInactive')}</dd>
      </div>
      <div>
        <dt class="text-muted">{$t('dateAdded')}</dt>
        <dd>{formatDate(viewing.createdAt)}</dd>
      </div>
    </dl>
    <div class="mt-4 flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onclick={() => openEdit(viewing!)}>{$t('editStaff')}</Button>
      <Button size="sm" variant="outline" onclick={() => resetPassword(viewing!)}
        >{$t('resetStaffPassword')}</Button
      >
      {#if viewing.isActive}
        <Button
          size="sm"
          variant="danger"
          disabled={isSelf(viewing)}
          onclick={() => setActive(viewing!, false)}>{$t('removeStaffAccess')}</Button
        >
      {:else}
        <Button size="sm" variant="primary" onclick={() => setActive(viewing!, true)}
          >{$t('activateStaff')}</Button
        >
      {/if}
    </div>
  {/if}
</Modal>
