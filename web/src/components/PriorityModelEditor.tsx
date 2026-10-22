import { Button } from './Button.js';
import { Field } from './Field.js';
import { ConfigurationSelect } from './ConfigurationSelect.js';
import { modelLabels, paletteLabels, type ConfigurationDraft } from './configuration-model.js';
type Model = ConfigurationDraft['priority_model'];
function NamedLevels({ model, onChange }: { model: Model; onChange: (value: Model) => void }) {
  function update(index: number, key: 'id' | 'label' | 'color', value: string) {
    onChange({
      ...model,
      levels: model.levels.map((level, position) =>
        position === index ? { ...level, [key]: value } : level,
      ),
    });
  }
  function move(index: number, delta: number) {
    const levels = [...model.levels];
    const next = levels[index + delta];
    const current = levels[index];
    if (!next || !current) return;
    levels[index] = next;
    levels[index + delta] = current;
    onChange({ ...model, levels });
  }
  return (
    <fieldset>
      <legend>Именованные уровни: важные выше</legend>
      {model.levels.map((level, index) => (
        <fieldset key={index}>
          <legend>Уровень {index + 1}</legend>
          <Field
            label="Идентификатор уровня"
            value={level.id}
            onChange={(event) => update(index, 'id', event.target.value)}
          />
          <Field
            label="Название уровня"
            value={level.label}
            onChange={(event) => update(index, 'label', event.target.value)}
          />
          <ConfigurationSelect
            label="Цвет уровня"
            value={level.color}
            onChange={(value) => update(index, 'color', value)}
            empty="Без цвета"
            options={Object.entries(paletteLabels).map(([value, label]) => ({ value, label }))}
          />
          <div className="actions">
            <Button disabled={index === 0} onClick={() => move(index, -1)}>
              Выше
            </Button>
            <Button disabled={index === model.levels.length - 1} onClick={() => move(index, 1)}>
              Ниже
            </Button>
            <Button
              onClick={() =>
                onChange({
                  ...model,
                  levels: model.levels.filter((_, position) => position !== index),
                })
              }
            >
              Удалить уровень
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        disabled={model.levels.length >= 100}
        onClick={() =>
          onChange({
            ...model,
            levels: [
              ...model.levels,
              { id: `level_${model.levels.length + 1}`, label: 'Новый уровень', color: '' },
            ],
          })
        }
      >
        Добавить уровень
      </Button>
    </fieldset>
  );
}
export function PriorityModelEditor({
  model,
  onChange,
}: {
  model: Model;
  onChange: (value: Model) => void;
}) {
  return (
    <section>
      <ConfigurationSelect
        label="Модель приоритета"
        value={model.type}
        onChange={(type) => onChange({ ...model, type })}
        options={Object.entries(modelLabels).map(([value, label]) => ({ value, label }))}
      />
      {model.type === 'numeric' && (
        <>
          <Field
            label="Минимум"
            type="number"
            step="0.001"
            min={-1000000000}
            max={1000000000}
            value={model.min}
            onChange={(event) => onChange({ ...model, min: event.target.value })}
          />
          <Field
            label="Максимум"
            type="number"
            step="0.001"
            min={-1000000000}
            max={1000000000}
            value={model.max}
            onChange={(event) => onChange({ ...model, max: event.target.value })}
          />
          <ConfigurationSelect
            label="Направление"
            value={model.direction}
            onChange={(direction) => onChange({ ...model, direction })}
            options={[
              { value: 'higher', label: 'Больше — важнее' },
              { value: 'lower', label: 'Меньше — важнее' },
            ]}
          />
        </>
      )}
      {model.type === 'named' && <NamedLevels model={model} onChange={onChange} />}
      {model.type === 'classic' && (
        <p>Критический, высокий, обычный, низкий. Приоритет задачи можно не задавать.</p>
      )}
      {model.type === 'eisenhower' && (
        <p>Важность и срочность выбираются независимо. Приоритет задачи можно не задавать.</p>
      )}
    </section>
  );
}
