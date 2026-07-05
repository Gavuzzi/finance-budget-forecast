-- ============================================================================
-- Second tenant — "Vantage Consulting AB", a small consulting firm.
-- Deliberately a DIFFERENT shape from the manufacturer (different cost centers, roles,
-- assumptions, and scale) to prove config-not-code: the same app renders a
-- completely different company with zero code changes.
--
-- Run in: Supabase SQL Editor. Guarded so re-running won't duplicate.
-- ============================================================================

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000002';
  d_sr     uuid := 'd0000000-0000-0000-0000-000000000001';
  d_cons   uuid := 'd0000000-0000-0000-0000-000000000002';
  d_jr     uuid := 'd0000000-0000-0000-0000-000000000003';
  d_lead   uuid := 'd0000000-0000-0000-0000-000000000004';
  d_ops    uuid := 'd0000000-0000-0000-0000-000000000005';
  d_admin  uuid := 'd0000000-0000-0000-0000-000000000006';
  e_deliv  uuid := 'e0000000-0000-0000-0000-000000000001';
  e_bizdev uuid := 'e0000000-0000-0000-0000-000000000002';
  e_ops    uuid := 'e0000000-0000-0000-0000-000000000003';
begin
  if exists (select 1 from organizations where id = v_org) then
    return; -- already seeded
  end if;

  insert into organizations (id, name, close_month, currency)
    values (v_org, 'Vantage Consulting AB', 6, 'SEK');

  insert into assumptions (org_id, employer_contribution_pct, equipment_monthly, other_overhead_pct)
    values (v_org, 31.42, 1500, 6);

  insert into roles (id, org_id, label, base_salary) values
    (d_sr,    v_org, 'Senior Consultant', 58000),
    (d_cons,  v_org, 'Consultant', 42000),
    (d_jr,    v_org, 'Junior Consultant', 32000),
    (d_lead,  v_org, 'Project Lead', 55000),
    (d_ops,   v_org, 'Operations Manager', 48000),
    (d_admin, v_org, 'Office Administrator', 30000);

  insert into cost_centers (id, org_id, name, annual_budget, other_monthly) values
    (e_deliv,  v_org, 'Consulting Delivery', 8000000, 80000),
    (e_bizdev, v_org, 'Business Development', 3000000, 60000),
    (e_ops,    v_org, 'Operations', 2500000, 120000);

  insert into headcount_lines (org_id, cost_center_id, role_id, count, start_month, end_month) values
    (v_org, e_deliv,  d_sr,   4, 1, 24),
    (v_org, e_deliv,  d_cons, 6, 1, 24),
    (v_org, e_deliv,  d_jr,   2, 3, 24),
    (v_org, e_bizdev, d_lead, 2, 1, 24),
    (v_org, e_ops,    d_ops,  1, 1, 24),
    (v_org, e_ops,    d_admin, 2, 1, 24);

  insert into one_offs (org_id, cost_center_id, label, amount, month) values
    (v_org, e_deliv,  'Team conference & training', 120000, 9),
    (v_org, e_bizdev, 'Rebrand & new website', 250000, 10),
    (v_org, e_ops,    'Office relocation', 180000, 8);

  insert into monthly_actual (org_id, cost_center_id, month, amount) values
    (v_org, e_deliv, 1,640000),(v_org, e_deliv, 2,660000),(v_org, e_deliv, 3,700000),
    (v_org, e_deliv, 4,680000),(v_org, e_deliv, 5,690000),(v_org, e_deliv, 6,710000),
    (v_org, e_bizdev,1,240000),(v_org, e_bizdev,2,250000),(v_org, e_bizdev,3,260000),
    (v_org, e_bizdev,4,255000),(v_org, e_bizdev,5,248000),(v_org, e_bizdev,6,262000),
    (v_org, e_ops,   1,200000),(v_org, e_ops,   2,210000),(v_org, e_ops,   3,205000),
    (v_org, e_ops,   4,215000),(v_org, e_ops,   5,208000),(v_org, e_ops,   6,212000);
end $$;

-- Link your login to this org too, so the switcher shows both.
insert into memberships (user_id, org_id, role)
select id, 'a0000000-0000-0000-0000-000000000002', 'owner'
from auth.users where email = 'felixroos@gmail.com'
on conflict do nothing;
