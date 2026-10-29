'use client';

import { type ChangeEvent, createContext, type FormHTMLAttributes, type ReactElement, type ReactNode, useContext, useId, useMemo } from 'react';
import {
	Controller,
	type DefaultValues,
	type FieldErrors,
	type FieldPath,
	type FieldPathValue,
	type FieldValues,
	FormProvider,
	get,
	type RefCallBack,
	type Resolver,
	set,
	type UseFormReturn,
	useForm,
	useFormContext,
} from 'react-hook-form';
import type { z } from 'zod';
import { Button, type ButtonProps } from '../../actions-controls/button/button';
import { cn } from '../../utils/tailwind/cn';

/** Any zod schema whose input is an object — what a form's values look like. Pass a `const` schema and every type below is inferred from it. */
export type FormSchema = z.ZodType<unknown, FieldValues>;

/** Values as the fields hold them (`z.input`), before zod transforms/coerces them. */
export type FormInput<TSchema extends FormSchema> = z.input<TSchema>;

/** Values `onSubmit` receives (`z.output`), after zod parsed, transformed and coerced them. */
export type FormOutput<TSchema extends FormSchema> = z.output<TSchema>;

/** Validates with the zod schema and maps each issue to the field at its path (`address.street`, `items.0.name`). Root-level issues land in `errors.root`. */
function createSchemaResolver<TSchema extends FormSchema>(schema: TSchema): Resolver<FormInput<TSchema>, unknown, FormOutput<TSchema>> {
	return async values => {
		const result = await schema.safeParseAsync(values);
		if (result.success) {
			return {
				errors: {},
				values: result.data as FormOutput<TSchema>,
			};
		}

		const errors: Record<string, unknown> = {};
		for (const issue of result.error.issues) {
			const path = issue.path.length ? issue.path.join('.') : 'root';
			// First issue per field wins, like every other resolver.
			if (!get(errors, path)) {
				set(errors, path, {
					message: issue.message,
					type: issue.code,
				});
			}
		}

		return {
			errors: errors as FieldErrors<FormInput<TSchema>>,
			values: {},
		};
	};
}

/**
 * What a control reports through its change callback. Kept loose on purpose: controls type their callbacks
 * with the widest value they can emit (`RadioGroup` reports `string`, not your enum), and a strictly typed
 * setter can't be passed to them. Zod still validates the real value.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above — the setter must accept whatever the control emits
type ControlValue = any;

/** What a field hands to its children. `value`, `error` and the change handlers are all you need; the `*Props` bags spread straight onto the matching kind of control. */
export interface FormFieldRenderProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
	/** Path of the field in the schema. */
	name: TName;
	/** Current value, typed from the schema. */
	value: FieldPathValue<TValues, TName>;
	/** Sets the value and validates it. */
	onChange: (value: FieldPathValue<TValues, TName>) => void;
	/** Marks the field as touched; validation starts here in the default `"onTouched"` mode. */
	onBlur: () => void;
	/** Ref to the underlying element, so a failed submit can focus the first invalid field. */
	ref: RefCallBack;
	/** Validation message from zod, or `undefined` while the field is valid. Pass it to components that render their own error UI (`Input`, `InputOtp`). */
	error?: string;
	/** `true` while the field has an error. */
	invalid: boolean;
	/** Whether the user has left the field at least once. */
	isTouched: boolean;
	/** Whether the value differs from its default. */
	isDirty: boolean;
	/** Whether the field is disabled, by the form or by the field itself. */
	disabled?: boolean;
	/** `id` of the `Form.Message` for this field; use it in `aria-describedby` on custom controls. */
	messageId: string;
	/** For native-event controls: `Input.Field`, `Input.Textarea`, `<input>`, `<textarea>`, `<select>`. */
	inputProps: {
		name: TName;
		value: string;
		onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
		onBlur: () => void;
		ref: RefCallBack;
		disabled?: boolean;
		'aria-invalid': boolean;
	};
	/** For `value` + `onValueChange` controls: `RadioGroup`, `Slider`, `ToggleGroup`, `FormStarRating`. */
	valueProps: {
		value: FieldPathValue<TValues, TName>;
		onValueChange: (value: ControlValue) => void;
		disabled?: boolean;
	};
	/** For `value` + `onChange(value)` controls: `Select`, `DatePicker`, `InputOtp`. */
	changeProps: {
		value: FieldPathValue<TValues, TName>;
		onChange: (value: ControlValue) => void;
		disabled?: boolean;
	};
	/** For `checked` + `onCheckedChange` controls: `Checkbox`, `Switch`. */
	checkedProps: {
		checked: boolean;
		onCheckedChange: (checked: boolean) => void;
		disabled?: boolean;
	};
}

interface FormFieldContextValue {
	name: string;
	error?: string;
	messageId: string;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/** Inside `Form.Field`: the field's `name`, current `error` and `messageId`. */
export function useFormField() {
	const context = useContext(FormFieldContext);
	if (!context) {
		throw new Error('useFormField must be used within <Form.Field>');
	}
	return context;
}

/** The react-hook-form instance of the closest `Form` (`watch`, `setValue`, `setError`, `reset`, `formState`…), typed from the schema: `useFormApi<typeof schema>()`. */
export function useFormApi<TSchema extends FormSchema>() {
	return useFormContext<FormInput<TSchema>, unknown, FormOutput<TSchema>>();
}

export interface FormFieldProps<TValues extends FieldValues = FieldValues, TName extends FieldPath<TValues> = FieldPath<TValues>> {
	/** Path of the field in the schema, autocompleted and checked against it when `Field` comes from `Form`'s render prop or has its type argument set. */
	name: TName;
	/** Disables just this field. */
	disabled?: boolean;
	/** The control, as a render function receiving the field's state and prop bags, or plain elements that read it through `Form.Message` / `useFormField`. */
	children: ReactNode | ((field: FormFieldRenderProps<TValues, TName>) => ReactNode);
}

/**
 * Connects one schema field to whatever control you render. It subscribes only
 * to its own value, so typing in one field never re-renders the others.
 * Discrete controls (`valueProps`, `changeProps`, `checkedProps`) also count as
 * touched on change, since they have no meaningful blur.
 */
function Field<TValues extends FieldValues = FieldValues, TName extends FieldPath<TValues> = FieldPath<TValues>>({ name, disabled, children }: FormFieldProps<TValues, TName>) {
	const { control } = useFormContext<TValues>();
	const messageId = `${useId()}-message`;

	return (
		<Controller
			control={control}
			disabled={disabled}
			name={name}
			render={({ field, fieldState, formState }) => {
				type Value = FieldPathValue<TValues, TName>;
				const error = fieldState.error?.message;
				const isDisabled = field.disabled || formState.isSubmitting;
				const change = (value: Value) => {
					field.onChange(value);
					field.onBlur();
				};

				const props: FormFieldRenderProps<TValues, TName> = {
					changeProps: {
						disabled: field.disabled,
						onChange: change,
						value: field.value,
					},
					checkedProps: {
						checked: Boolean(field.value),
						disabled: field.disabled,
						onCheckedChange: checked => change(checked as Value),
					},
					disabled: isDisabled,
					error,
					inputProps: {
						'aria-invalid': Boolean(error),
						disabled: field.disabled,
						name: field.name,
						onBlur: field.onBlur,
						onChange: event => field.onChange(event.target.value),
						ref: field.ref,
						value: (field.value ?? '') as string,
					},
					invalid: Boolean(error),
					isDirty: fieldState.isDirty,
					isTouched: fieldState.isTouched,
					messageId,
					name: field.name,
					onBlur: field.onBlur,
					onChange: field.onChange,
					ref: field.ref,
					value: field.value,
					valueProps: {
						disabled: field.disabled,
						onValueChange: change,
						value: field.value,
					},
				};

				return (
					<FormFieldContext.Provider
						value={{
							error,
							messageId,
							name: field.name,
						}}
					>
						{typeof children === 'function' ? children(props) : children}
					</FormFieldContext.Provider>
				);
			}}
		/>
	);
}

export interface FormMessageProps {
	/** Replaces the validation message with your own text. Nothing renders while the field is valid, so a custom message is only shown on error too. */
	children?: ReactNode;
	/** Additional classes applied to the message. */
	className?: string;
}

/**
 * The field's validation error, announced to screen readers (`role="alert"`).
 * Only needed for controls without their own error UI (`Select`, `Checkbox`,
 * `RadioGroup`…); `Input` and `InputOtp` already show it through `errorMessage`.
 */
function Message({ children, className }: FormMessageProps) {
	const { error, messageId } = useFormField();
	const content = error ? (children ?? error) : null;

	if (!content) return null;

	return (
		<p className={cn('font-primary text-xs text-destructive', className)} id={messageId} role='alert'>
			{content}
		</p>
	);
}

export interface FormSubmitProps extends Omit<ButtonProps, 'type'> {}

/** Submit button: shows the loading state while `onSubmit` is pending and blocks double submits. Takes the same props as `Button`; a plain string child is wrapped in `Button.Text` so it gets the variant's text color, otherwise compose `Button.Icon`/`Button.Text` yourself. */
function Submit({ children, ...props }: FormSubmitProps) {
	const {
		formState: { isSubmitting },
	} = useFormContext();

	return (
		<Button loading={isSubmitting} type='submit' {...props}>
			{typeof children === 'string' ? <Button.Text>{children}</Button.Text> : children}
		</Button>
	);
}

/** What `Form`'s render-prop children receive, all typed from the schema. */
export interface FormRenderApi<TSchema extends FormSchema> {
	/** The react-hook-form instance: `watch`, `setValue`, `setError`, `reset`, `formState`… */
	form: UseFormReturn<FormInput<TSchema>, unknown, FormOutput<TSchema>>;
	/** `Form.Field` with `name` autocompleted from the schema and `value` typed per field. */
	Field: <TName extends FieldPath<FormInput<TSchema>>>(props: FormFieldProps<FormInput<TSchema>, TName>) => ReactElement;
}

export interface FormRootProps<TSchema extends FormSchema> extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit' | 'onInvalid' | 'children' | 'defaultValue'> {
	/** The zod schema. Declare it as a `const` and everything is inferred: field names, field values, and the data `onSubmit` receives. */
	schema: TSchema;
	/** Initial values of the fields (`z.input` shape). */
	defaultValues?: DefaultValues<FormInput<TSchema>>;
	/** Values to sync into the form, e.g. a record loaded from an API. The form resets whenever this changes. */
	values?: FormInput<TSchema>;
	/** Called with the parsed data (`z.output`, so transforms and coercions are already applied) once every field is valid. Return a promise to keep the submit button loading. */
	onSubmit: (data: FormOutput<TSchema>, form: UseFormReturn<FormInput<TSchema>, unknown, FormOutput<TSchema>>) => void | Promise<void>;
	/** Called with the errors when the user submits an invalid form. */
	onInvalid?: (errors: FieldErrors<FormInput<TSchema>>) => void;
	/**
	 * When fields validate. `"onTouched"` validates when a field is first left, then on every change.
	 * @default "onTouched"
	 */
	mode?: 'onSubmit' | 'onBlur' | 'onChange' | 'onTouched' | 'all';
	/** Disables every field. */
	disabled?: boolean;
	/** The fields. Either plain elements, or a function receiving `{ form, Field }` typed from the schema. */
	children: ReactNode | ((api: FormRenderApi<TSchema>) => ReactNode);
}

/**
 * Form wired to react-hook-form and a zod schema. Fields watch their own value,
 * zod validates on the schedule set by `mode`, and errors flow to the controls.
 * @example
 * ```tsx
 * const schema = z.object({
 *   email: z.email("Enter a valid email"),
 *   terms: z.boolean().refine(Boolean, "You must accept the terms"),
 * });
 *
 * <Form schema={schema} defaultValues={{ email: "", terms: false }} onSubmit={(data) => save(data)}>
 *   {({ Field }) => (
 *     <>
 *       <Field name="email">
 *         {(field) => (
 *           <Input errorMessage={field.error}>
 *             <Input.Label>Email</Input.Label>
 *             <Input.Field {...field.inputProps} />
 *           </Input>
 *         )}
 *       </Field>
 *       <Field name="terms">
 *         {(field) => (
 *           <>
 *             <Checkbox {...field.checkedProps}>
 *               <Checkbox.Toggle />
 *               <Checkbox.Label>Accept the terms</Checkbox.Label>
 *             </Checkbox>
 *             <Form.Message />
 *           </>
 *         )}
 *       </Field>
 *       <Form.Submit>Create account</Form.Submit>
 *     </>
 *   )}
 * </Form>
 * ```
 */
function Root<TSchema extends FormSchema>({ schema, defaultValues, values, onSubmit, onInvalid, mode = 'onTouched', disabled, children, ...props }: FormRootProps<TSchema>) {
	const resolver = useMemo(() => createSchemaResolver(schema), [schema]);

	const form = useForm<FormInput<TSchema>, unknown, FormOutput<TSchema>>({
		defaultValues,
		disabled,
		mode,
		resolver,
		values,
	});

	const api = useMemo<FormRenderApi<TSchema>>(
		() => ({
			Field: Field as unknown as FormRenderApi<TSchema>['Field'],
			form,
		}),
		[form]
	);

	return (
		<FormProvider {...form}>
			<form
				noValidate
				{...props}
				onSubmit={event => {
					void form.handleSubmit(data => onSubmit(data, form), onInvalid)(event);
				}}
			>
				{typeof children === 'function' ? children(api) : children}
			</form>
		</FormProvider>
	);
}

/**
 * Compound form component: `Form` owns the react-hook-form instance and the
 * zod schema; `Form.Field` binds a control to a field, `Form.Message` shows its
 * error, `Form.Submit` submits. Use `useFormApi` / `useFormField` from anywhere inside.
 */
export const Form = Object.assign(Root, {
	Field,
	Message,
	Submit,
});
