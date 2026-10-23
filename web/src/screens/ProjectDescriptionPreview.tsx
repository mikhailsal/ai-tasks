import { DescriptionPreview } from '../components/DescriptionPreview.js';

export function ProjectDescriptionPreview({
  slug,
  description,
  disabled,
}: {
  slug: string;
  description: string;
  disabled: boolean;
}) {
  return (
    <DescriptionPreview
      source={description}
      projectSlug={slug}
      disabled={disabled}
      label="Предпросмотр описания"
    />
  );
}
