import { useEffect } from 'react';
import { Checkbox, Drawer, Form, Input, Select, Space } from 'antd';
import type { Question, QuestionDraft, QuestionOption, QuestionType } from '@shared/types';
import { QUESTION_TYPE_LABELS } from '@shared/types';

type EditableQuestion = QuestionDraft | Question;

interface QuestionEditorDrawerProps {
  open: boolean;
  value: EditableQuestion | null;
  title: string;
  onClose: () => void;
  onSubmit: (value: EditableQuestion) => void;
}

const typeOptions = Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const buildOptionRecord = (options?: QuestionOption[]): Record<string, string> =>
  Object.fromEntries((options ?? []).map((option) => [`option_${option.key}`, option.text]));

const serializeAnswers = (type: QuestionType, raw: string): string[] => {
  if (type === 'multiple') {
    return raw
      .toUpperCase()
      .split(/[\s,，;；、]+|(?=[A-H])/)
      .map((item) => item.trim())
      .filter(Boolean)
      .flatMap((item) => (item.length > 1 && /^[A-H]+$/.test(item) ? item.split('') : [item]));
  }
  if (type === 'fill_blank') {
    return raw
      .split(/\n|[;；、]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return raw
    .split(/[\s,，;；、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 1);
};

export function QuestionEditorDrawer({ open, value, title, onClose, onSubmit }: QuestionEditorDrawerProps): JSX.Element {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!value) return;
    form.setFieldsValue({
      sourceNo: value.sourceNo,
      type: value.type,
      section: value.section,
      tagsText: value.tags.join('，'),
      stem: value.stem,
      answersText: value.answers.join(value.type === 'fill_blank' ? '\n' : ' '),
      explanation: value.explanation,
      isFavorite: 'id' in value ? value.isFavorite : false,
      ...buildOptionRecord(value.options)
    });
  }, [form, value]);

  return (
    <Drawer
      open={open}
      title={title}
      width={640}
      onClose={onClose}
      extra={
        <Space>
          <a onClick={() => form.submit()}>保存</a>
        </Space>
      }
    >
      {value ? (
        <Form
          layout="vertical"
          form={form}
          onFinish={(values) => {
            const type = values.type as QuestionType;
            const options =
              type === 'single' || type === 'multiple'
                ? (['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const)
                    .map((key) => ({ key, text: values[`option_${key}`] as string }))
                    .filter((option) => option.text?.trim())
                : undefined;

            onSubmit({
              ...value,
              sourceNo: values.sourceNo,
              type,
              section: values.section,
              tags: String(values.tagsText ?? '')
                .split(/[，,;；、]/)
                .map((item) => item.trim())
                .filter(Boolean),
              stem: values.stem,
              answers: serializeAnswers(type, String(values.answersText ?? '')),
              options,
              explanation: values.explanation,
              ...('id' in value ? { isFavorite: Boolean(values.isFavorite) } : {})
            });
          }}
        >
          <Form.Item label="题号" name="sourceNo" rules={[{ required: true, message: '请填写题号' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="题型" name="type" rules={[{ required: true, message: '请选择题型' }]}>
            <Select options={typeOptions} />
          </Form.Item>
          <Form.Item label="章节" name="section" rules={[{ required: true, message: '请填写章节' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="标签" name="tagsText">
            <Input placeholder="多个标签用顿号或逗号分隔" />
          </Form.Item>
          <Form.Item label="题干" name="stem" rules={[{ required: true, message: '请填写题干' }]}>
            <Input.TextArea rows={5} />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {({ getFieldValue }) =>
              ['single', 'multiple'].includes(getFieldValue('type')) ? (
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  {(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const).map((key) => (
                    <Form.Item key={key} label={`选项 ${key}`} name={`option_${key}`}>
                      <Input />
                    </Form.Item>
                  ))}
                </Space>
              ) : null
            }
          </Form.Item>
          <Form.Item label="答案" name="answersText" rules={[{ required: true, message: '请填写答案' }]}>
            <Input.TextArea rows={4} placeholder="多选可写 ABCD 或 A B C D；填空题可逐行填写" />
          </Form.Item>
          <Form.Item label="解析" name="explanation">
            <Input.TextArea rows={4} />
          </Form.Item>
          {'id' in value ? (
            <Form.Item name="isFavorite" valuePropName="checked">
              <Checkbox>加入收藏</Checkbox>
            </Form.Item>
          ) : null}
        </Form>
      ) : null}
    </Drawer>
  );
}
