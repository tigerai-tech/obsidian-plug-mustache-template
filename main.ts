import {App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TextComponent} from 'obsidian';
import * as Mustache from 'mustache';

// Remember to rename these classes and interfaces!

interface TemplatePluginSettings {
	templates: Template[];
}

interface Template {
	id: string;
	name: string;
	content: string;
	params: string[]; // 存储参数名称列表
	defaultValues: Record<string, string>; // 存储参数默认值
	isCommand?: boolean; // 标记是否将该模板添加为右键菜单命令
}

const DEFAULT_SETTINGS: TemplatePluginSettings = {
	templates: [{
		id: 'default',
		name: 'Styled H1',
		content: '<h1 style=" text-align: center; font-size: 3em; font-family: \'Georgia\', serif; color: #2c3e50; margin: 0.5em 0; padding: 10px 0; border-top: 4px solid #3498db; border-bottom: 4px solid #3498db; text-transform: uppercase; letter-spacing: 3px;">{{selectedText}}</h1>',
		params: ["selectedText"],
		defaultValues: {"selectedText": "Welcome to Mustache Template."}
	}, {
		id: "1746685230032",
		name: "YellowBgText",
		content: "<font style=\"background-color: #FFFACD; color:{{color}}; padding: 4px; border-radius: 8px; text-shadow: 1px 1px 2px rgba(0,0,0,0.1); font-weight: bold;\">{{selectedText}}</font>",
		params: [
			"color",
			"selectedText"
		],
		defaultValues: {
			"selectedText": "",
			"color": "tomato"
		},
		isCommand: true
	},]
}

export default class TemplatePlugin extends Plugin {
	settings: TemplatePluginSettings;

	async onload() {
		await this.loadSettings();

		// 只保留一个主命令用于选择模板并插入
		this.addCommand({
			id: 'insert-template',
			name: 'Insert template with parameters',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection() || '';
				const cursorPosition = editor.getCursor();

				if (this.settings.templates.length === 0) {
					new Notice('No templates configured. Please add a template in settings.');
					return;
				}

				new TemplateSelectionModal(this.app, this.settings.templates, selectedText, (result) => {
					if (selectedText) {
						editor.replaceSelection(result);
					} else {
						editor.replaceRange(result, cursorPosition);
					}
				}).open();
			}
		});

		// 为标记为命令的模板添加单独的命令
		this.registerTemplateCommands();

		// 添加编辑器右键菜单
		this.registerEditorMenu();

		// 添加设置选项卡
		this.addSettingTab(new TemplateSettingTab(this.app, this));
	}

	onunload() {
		// 清除所有注册的模板命令
		const appCommands = (this.app as any).commands;
		if (appCommands && typeof appCommands.listCommands === 'function') {
			appCommands.listCommands()
				.filter((cmd: any) => cmd.id.startsWith('mustache-template-inserter:template-'))
				.forEach((cmd: any) => {
					if (typeof appCommands.removeCommand === 'function') {
						appCommands.removeCommand(cmd.id);
					}
				});
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		// 确保所有模板都有params字段
		this.settings.templates.forEach(template => {
			if (!template.params) {
				// 从模板内容中提取参数
				template.params = this.extractParamsFromTemplate(template.content);
			}
		});
	}

	// 从模板内容中提取参数名
	extractParamsFromTemplate(templateContent: string): string[] {
		const params = new Set<string>();
		
		// 匹配基本参数 {{param}}
		const basicRegex = /\{\{([^#^\/!><=\s{}]+)\}\}/g;
		let match;
		
		while ((match = basicRegex.exec(templateContent)) !== null) {
			const param = match[1].trim();
			params.add(param);
		}
		
		// 匹配条件块中的参数 {{#param}}
		const condRegex = /\{\{#([^><=\s{}]+)\}\}/g;
		
		while ((match = condRegex.exec(templateContent)) !== null) {
			const param = match[1].trim();
			params.add(param);
		}
		
		return Array.from(params);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// 注册模板命令
	registerTemplateCommands() {
		// 清除旧命令 (在重新加载插件或者更新设置时)
		// 使用as any来解决App中缺少commands属性的类型错误
		const appCommands = (this.app as any).commands;
		if (appCommands && typeof appCommands.listCommands === 'function') {
			appCommands.listCommands()
				.filter((cmd: any) => cmd.id.startsWith('mustache-template-inserter:template-'))
				.forEach((cmd: any) => {
					if (typeof appCommands.removeCommand === 'function') {
						appCommands.removeCommand(cmd.id);
					}
				});
		}

		// 为每个被标记为命令的模板创建命令
		this.settings.templates.forEach(template => {
			if (template.isCommand) {
				this.addCommand({
					id: `template-${template.id}`,
					name: `Template: ${template.name}`,
					editorCallback: (editor: Editor, view: MarkdownView) => {
						// 没选中文本时，使用模板设置的selectedText默认值
						const selectedText = editor.getSelection() || template.defaultValues?.selectedText || '';
						const cursorPosition = editor.getCursor();

						// 如果模板有参数，打开参数输入模态窗口
						if (template.params && template.params.length > 0) {
							new TemplateParameterModal(this.app, template, selectedText, (result) => {
								if (editor.getSelection()) {
									editor.replaceSelection(result);
								} else {
									editor.replaceRange(result, cursorPosition);
								}
							}).open();
						} else {
							// 无参数模板，直接渲染并插入
							try {
								const templateData = {selectedText};
								const renderedTemplate = Mustache.render(template.content, templateData);
								if (editor.getSelection()) {
									editor.replaceSelection(renderedTemplate);
								} else {
									editor.replaceRange(renderedTemplate, cursorPosition);
								}
							} catch (error) {
								console.error('Template processing error:', error);
								new Notice(`Template error: ${error instanceof Error ? error.message : String(error)}`);
							}
						}
					}
				});
			}
		});
	}

	// 注册编辑器右键菜单
	registerEditorMenu() {
		// 添加编辑器菜单
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				// 获取被标记为命令的模板
				const commandTemplates = this.settings.templates.filter(t => t.isCommand);

				if (commandTemplates.length > 0) {
					// 创建子菜单
					menu.addItem((item) => {
						item.setTitle("模板插入")
							.setIcon("text-cursor-input")
							.setSection("templater")
							.onClick(() => {
								// 主菜单项点击时，打开模板选择窗口
								const selectedText = editor.getSelection() || '';
								const cursorPosition = editor.getCursor();

								new TemplateSelectionModal(this.app, this.settings.templates, selectedText, (result) => {
									if (editor.getSelection()) {
										editor.replaceSelection(result);
									} else {
										editor.replaceRange(result, cursorPosition);
									}
								}).open();
							});
					});

					// 为每个被标记为命令的模板创建子菜单项
					commandTemplates.forEach(template => {
						menu.addItem((item) => {
							item.setTitle(`模板: ${template.name}`)
								.setSection("templater")
								.onClick(() => {
									// 没选中文本时，使用模板设置的selectedText默认值
									const selectedText = editor.getSelection() || template.defaultValues?.selectedText || '';
									const cursorPosition = editor.getCursor();

									// 如果模板有参数，打开参数输入模态窗口
									if (template.params && template.params.length > 0) {
										new TemplateParameterModal(this.app, template, selectedText, (result) => {
											if (editor.getSelection()) {
												editor.replaceSelection(result);
											} else {
												editor.replaceRange(result, cursorPosition);
											}
										}).open();
									} else {
										// 无参数模板，直接渲染并插入
										try {
											const templateData = {selectedText};
											const renderedTemplate = Mustache.render(template.content, templateData);
											if (editor.getSelection()) {
												editor.replaceSelection(renderedTemplate);
											} else {
												editor.replaceRange(renderedTemplate, cursorPosition);
											}
										} catch (error) {
											console.error('Template processing error:', error);
											new Notice(`Template error: ${error instanceof Error ? error.message : String(error)}`);
										}
									}
								});
						});
					});
				}
			})
		);
	}
}

// 模板选择模态窗口
class TemplateSelectionModal extends Modal {
	templates: Template[];
	selectedText: string;
	onSubmit: (result: string) => void;

	constructor(app: App, templates: Template[], selectedText: string, onSubmit: (result: string) => void) {
		super(app);
		this.templates = templates;
		this.selectedText = selectedText;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.addClass('template-selection-modal');

		contentEl.createEl('h2', {text: 'Select Template'});

		this.templates.forEach(template => {
			new Setting(contentEl)
				.setName(template.name)
				.addButton(button => button
					.setButtonText('Use')
					.setCta()
					.onClick(() => {
						this.close();
						// 检查模板是否有参数
						if (template.params && template.params.length > 0) {
							// 如果没有选中文本，使用模板设置的默认值
							const effectiveSelectedText = this.selectedText || template.defaultValues?.selectedText || '';

							// 有参数的模板，打开参数输入窗口
							new TemplateParameterModal(
								this.app,
								template,
								effectiveSelectedText,
								this.onSubmit
							).open();
						} else {
							// 无参数模板，直接渲染并插入
							try {
								// 如果没有选中文本，使用模板设置的默认值
								const effectiveSelectedText = this.selectedText || template.defaultValues?.selectedText || '';
								const templateData = {selectedText: effectiveSelectedText};
								const renderedTemplate = Mustache.render(template.content, templateData);
								this.onSubmit(renderedTemplate);
							} catch (error) {
								console.error('Template processing error:', error);
								new Notice(`Template error: ${error instanceof Error ? error.message : String(error)}`);
							}
						}
					}));
		});
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

// 模板参数输入模态窗口
class TemplateParameterModal extends Modal {
	template: Template;
	selectedText: string;
	onSubmit: (result: string) => void;
	paramValues: Record<string, string> = {}; // 用于存储参数值的对象
	paramInputs: Record<string, TextComponent> = {}; // 存储参数输入组件

	constructor(app: App, template: Template, selectedText: string, onSubmit: (result: string) => void) {
		super(app);
		this.template = template;
		this.selectedText = selectedText;
		this.onSubmit = onSubmit;
		
		// 初始化参数值为默认值或空字符串
		if (this.template.params) {
			this.template.params.forEach(param => {
				// 如果已经有选中文本，且参数是selectedText，则使用选中文本
				if (param === 'selectedText' && selectedText) {
					this.paramValues[param] = selectedText;
				} else {
					this.paramValues[param] = this.template.defaultValues?.[param] || '';
				}
			});
		}
	}

	onOpen() {
		const {contentEl} = this;
		
		contentEl.addClass('template-parameter-modal');

		// 如果没有参数，立即处理并返回
		if (!this.template.params || this.template.params.length === 0) {
			this.processTemplate();
			this.close();
			return;
		}
		
		contentEl.createEl('h2', {text: 'Enter Template Parameters'});
		
		// 创建表单容器
		const form = contentEl.createEl('form');
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			this.processTemplate();
		});

		// 为每个参数创建输入字段
		this.template.params.forEach(param => {
			const paramSetting = new Setting(form)
				.setName(param)
				.setDesc(`Enter value for ${param}`);

			paramSetting.addText(text => {
				this.paramInputs[param] = text;
				// 设置默认值
				const defaultValue = this.template.defaultValues?.[param] || '';
				text.setValue(defaultValue)
					.setPlaceholder(`Enter ${param}`)
					.onChange(value => {
						this.paramValues[param] = value;
					});
			});
		});
		
		// 提交按钮
		new Setting(form)
			.addButton(button => button
				.setButtonText('Insert Template')
				.setCta()
				.onClick(() => {
					this.processTemplate();
				}));
				
		// 聚焦第一个输入框
		setTimeout(() => {
			const firstParam = this.template.params?.[0];
			if (firstParam && this.paramInputs[firstParam]?.inputEl) {
				this.paramInputs[firstParam].inputEl.focus();
			}
		}, 10);
	}

	processTemplate() {
		try {
			// 创建包含所有参数值的对象，并添加selectedText
			const templateData: Record<string, any> = {
				...this.paramValues,
				selectedText: this.selectedText
			};
			
			// 简化的模板渲染
			// 不再尝试处理复杂的条件逻辑，使用基本的Mustache替换功能
			let renderedTemplate = '';
			
			try {
				renderedTemplate = Mustache.render(this.template.content, templateData);
			} catch (renderError) {
				console.error('Mustache render error:', renderError);
				
				// 降级处理：手动替换简单变量
				renderedTemplate = this.template.content;
				
				// 替换所有简单变量 {{varName}}
				Object.keys(templateData).forEach(key => {
					const value = templateData[key] || '';
					const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
					renderedTemplate = renderedTemplate.replace(regex, value);
				});
				
				// 移除所有条件块，处理多行情况
				renderedTemplate = renderedTemplate.replace(/\{\{#.*?\}\}[\s\S]*?\{\{\/.*?\}\}/g, '');
			}
			
			this.onSubmit(renderedTemplate);
			this.close();
		} catch (error) {
			console.error('Template processing error:', error);
			new Notice(`Template error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class TemplateSettingTab extends PluginSettingTab {
	plugin: TemplatePlugin;

	constructor(app: App, plugin: TemplatePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'Template Manager'});
		containerEl.createEl('p', {text: 'Create and manage your templates here.'});

		// 添加新模板按钮
		new Setting(containerEl)
			.setName('Add New Template')
			.setDesc('Create a new template')
			.addButton(button => button
				.setButtonText('Add Template')
				.setCta()
				.onClick(() => {
					this.plugin.settings.templates.push({
						id: String(Date.now()),
						name: 'New Template',
						content: '{{selectedText}}',
						params: [],
						defaultValues: {},
						isCommand: false
					});
					this.plugin.saveSettings();
					this.display();
				}));

		// 显示现有模板列表
		containerEl.createEl('h3', {text: 'Your Templates'});

		// 创建每个模板的容器div
		const templatesContainer = containerEl.createDiv('templates-container');
		templatesContainer.createEl("p", {text: 'Remember to Exit Obsidian APP and Referesh Data after Saving any changes.'});
		this.plugin.settings.templates.forEach((template, index) => {
			// 创建每个模板的主容器
			const templateItemContainer = templatesContainer.createDiv('template-item-container');

			// 创建模板标题行
			const templateHeader = templateItemContainer.createDiv('template-header');

			// 添加模板名称
			templateHeader.createDiv('template-name').setText(template.name);

			// 添加命令开关
			const toggleContainer = templateHeader.createDiv('template-toggle-container');
			const toggle = new Setting(toggleContainer)
				.setClass('template-command-toggle')
				.addToggle(toggle => {
					toggle.setValue(template.isCommand || false)
						.onChange(async (value) => {
							// 更新模板的isCommand属性
							template.isCommand = value;
							await this.plugin.saveSettings();
							// 重新注册命令
							this.plugin.registerTemplateCommands();
						});
				});

			// 创建模板预览行 - 占据整个可用宽度
			const templatePreviewContainer = templateItemContainer.createDiv('template-preview-container');
			const template_head = template.content ? template.content.substring(0, template.content.length > 100 ? 100 : template.content.length) : "<empty>";
			templatePreviewContainer.createEl('input', {
				type: 'text',
				attr: {
					readonly: 'readonly',
					value: template_head,
					style: 'width: 100%; border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 8px;'
				}
			});

			// 添加操作按钮行
			const buttonContainer = templateItemContainer.createDiv('template-button-container');
			
			// 添加编辑按钮
			const editButton = buttonContainer.createEl('button', {
				text: 'Edit',
				cls: 'template-edit-button',
			});
			editButton.addEventListener('click', () => {
				new TemplateEditModal(
					this.app,
					template,
					async (updatedTemplate) => {
						this.plugin.settings.templates[index] = updatedTemplate;
						await this.plugin.saveSettings();
						this.display();
					}
				).open();
			});
			
			// 添加删除按钮
			const deleteButton = buttonContainer.createEl('button', {
				text: 'Delete',
				cls: 'template-delete-button',
			});
			deleteButton.addEventListener('click', async () => {
				this.plugin.settings.templates.splice(index, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});
	}
}

// 模板编辑模态窗口
class TemplateEditModal extends Modal {
	template: Template;
	onSubmit: (result: Template) => void;
	templateContent: string;
	templateName: string;
	templateParams: string[] = [];
	templateDefaultValues: Record<string, string> = {};
	templateIsCommand: boolean;

	constructor(app: App, template: Template, onSubmit: (result: Template) => void) {
		super(app);
		this.template = template;
		this.onSubmit = onSubmit;
		this.templateContent = template.content;
		this.templateName = template.name;
		this.templateParams = template.params ? [...template.params] : [];
		this.templateDefaultValues = template.defaultValues ? {...template.defaultValues} : {};
		this.templateIsCommand = template.isCommand || false;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.addClass('template-edit-modal');

		contentEl.createEl('h2', {text: 'Edit Template'});

		// 模板名称输入
		new Setting(contentEl)
			.setName('Template Name')
			.addText(text => text
				.setPlaceholder('Template name')
				.setValue(this.templateName)
				.onChange(value => {
					this.templateName = value;
				}));

		// 添加到右键菜单设置
		new Setting(contentEl)
			.setName('Add to right-click menu command')
			.setDesc('Add this template to the context menu on the right side of the editor')
			.addToggle(toggle => {
				toggle.setValue(this.templateIsCommand)
					.onChange(value => {
						this.templateIsCommand = value;
					});
			});

		// 模板内容输入区域
		contentEl.createEl('h3', {text: 'Template Content'});
		contentEl.createEl('p', {
			text: 'Use {{paramName}} for parameters. {{selectedText}} is always available.',
			cls: 'setting-item-description'
		});

		const textAreaContainer = contentEl.createDiv();
		const textArea = textAreaContainer.createEl('textarea', {
			attr: {
				rows: '10',
				style: 'width: 100%; font-family: monospace;'
			}
		});
		textArea.value = this.templateContent;
		textArea.addEventListener('input', (e) => {
			const target = e.target as HTMLTextAreaElement;
			this.templateContent = target.value;
			
			// 自动更新参数列表
			const plugin = (this.app as any).plugins.plugins['obsidian-template-inserter'];
			if (plugin) {
				const newParams = plugin.extractParamsFromTemplate(this.templateContent);
				
				// 添加新检测到的参数，并为它们创建默认值空记录
				newParams.forEach((param: string) => {
					if (!this.templateParams.includes(param)) {
						this.templateDefaultValues[param] = '';
					}
				});
				
				// 移除不再存在的参数的默认值
				this.templateParams.forEach((param: string) => {
					if (!newParams.includes(param) && this.templateDefaultValues[param] !== undefined) {
						delete this.templateDefaultValues[param];
					}
				});
				
				this.templateParams = newParams;
				this.updateParamsList();
			}
		});
		
		// 参数列表和默认值设置区域
		contentEl.createEl('h3', {text: 'Template Parameters & Default Values'});
		const paramsContainer = contentEl.createDiv('template-params-container');
		this.updateParamsList(paramsContainer);

		// 保存按钮
		new Setting(contentEl)
			.addButton(button => button
				.setButtonText('Save Template')
				.setCta()
				.onClick(() => {
					const updatedTemplate: Template = {
						id: this.template.id,
						name: this.templateName,
						content: this.templateContent,
						params: this.templateParams,
						defaultValues: this.templateDefaultValues,
						isCommand: this.templateIsCommand
					};
					this.onSubmit(updatedTemplate);
					this.close();
				}));
	}

	updateParamsList(container?: HTMLElement) {
		if (!container) {
			const el = this.contentEl.querySelector('.template-params-container');
			if (!el) return;
			container = el as HTMLElement;
		}
		
		container.empty();
		
		if (this.templateParams.length === 0) {
			container.createEl('p', {
				text: 'No parameters detected. Use {{paramName}} syntax in your template.',
				cls: 'no-params-message'
			});
		} else {
			// 为每个参数创建一个设置行，包含默认值输入
			this.templateParams.forEach((param: string) => {
				if (container) {  // 确保container不是undefined
					const paramSetting = new Setting(container)
						.setName(param)
						.setDesc('Set default value (optional)');
					
					paramSetting.addText(text => {
						const currentDefault = this.templateDefaultValues[param] || '';
						text.setPlaceholder('Default value')
							.setValue(currentDefault)
							.onChange(value => {
								this.templateDefaultValues[param] = value;
							});
					});
				}
			});
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}
