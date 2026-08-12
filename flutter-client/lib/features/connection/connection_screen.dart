import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/service_exception.dart';
import '../../design/components/app_button.dart';
import '../../design/components/app_feedback.dart';
import '../../l10n/app_localizations.dart';
import 'connection_controller.dart';

final class ConnectionScreen extends ConsumerStatefulWidget {
  const ConnectionScreen({super.key});

  @override
  ConsumerState<ConnectionScreen> createState() => _ConnectionScreenState();
}

String defaultServiceOrigin(TargetPlatform platform) => switch (platform) {
  TargetPlatform.android => 'http://10.0.2.2:3124',
  _ => 'http://127.0.0.1:3124',
};

final class _ConnectionScreenState extends ConsumerState<ConnectionScreen> {
  final formKey = GlobalKey<ShadFormState>();
  late final origin = TextEditingController(
    text: defaultServiceOrigin(defaultTargetPlatform),
  );

  @override
  void dispose() {
    origin.dispose();
    super.dispose();
  }

  Future<void> connect() async {
    if (!formKey.currentState!.saveAndValidate()) return;
    await ref.read(connectionProvider.notifier).connect(origin.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final connection = ref.watch(connectionProvider);
    final error = connection.error;
    return Scaffold(
      key: const Key('connection-route'),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: ShadForm(
                key: formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(LucideIcons.music2, size: 64),
                    const SizedBox(height: 16),
                    Text(
                      strings.connectTitle,
                      style: ShadTheme.of(context).textTheme.h3,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      strings.connectDescription,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    ShadInputFormField(
                      key: const Key('service-origin-field'),
                      id: 'origin',
                      controller: origin,
                      label: Text(strings.serviceOrigin),
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.done,
                      validator: (value) =>
                          value.trim().isEmpty ? strings.serviceOrigin : null,
                      onSubmitted: connection.isLoading
                          ? null
                          : (_) => connect(),
                    ),
                    const SizedBox(height: 12),
                    AppButton(
                      key: const Key('connect-button'),
                      loading: connection.isLoading,
                      onPressed: connect,
                      leading: const Icon(LucideIcons.link),
                      expands: true,
                      child: Text(
                        connection.isLoading
                            ? strings.connecting
                            : strings.connect,
                      ),
                    ),
                    if (error != null) ...[
                      const SizedBox(height: 12),
                      AppNotice.error(
                        key: const Key('connection-error'),
                        title: error is ServiceException
                            ? error.code
                            : strings.unknownError,
                        message: error is ServiceException
                            ? error.message
                            : error.toString(),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
