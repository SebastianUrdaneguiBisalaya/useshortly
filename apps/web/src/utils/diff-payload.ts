export function diffPayload<T extends object>(original: Partial<T>, current: Partial<T>): Partial<T> {
	const diff: Partial<T> = {};
	for (const key of Object.keys(current) as Array<keyof T>) {
		if (JSON.stringify(current[key]) !== JSON.stringify(original[key])) {
			diff[key] = current[key];
		}
	}
	return diff;
}
