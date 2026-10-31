import type { StepDetail } from '../player/key-steps';

export function StepDetailControl({
  detail,
  onChange,
}: {
  detail: StepDetail;
  onChange: (detail: StepDetail) => void;
}) {
  return (
    <label>
      显示{' '}
      <select
        aria-label="步骤显示"
        value={detail}
        onChange={(event) => onChange(event.target.value as StepDetail)}
      >
        <option value="key">关键步骤</option>
        <option value="all">全部步骤</option>
      </select>
    </label>
  );
}
