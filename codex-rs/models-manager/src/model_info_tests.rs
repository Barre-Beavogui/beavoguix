use super::*;
use crate::ModelsManagerConfig;
use codex_protocol::openai_models::ModelAvailabilityNux;
use pretty_assertions::assert_eq;

#[test]
fn reasoning_summaries_override_true_enables_support() {
    let model = model_info_from_slug("unknown-model");
    let config = ModelsManagerConfig {
        model_supports_reasoning_summaries: Some(true),
        ..Default::default()
    };

    let updated = with_config_overrides(model.clone(), &config);
    let mut expected = model;
    expected.supports_reasoning_summaries = true;

    assert_eq!(updated, expected);
}

#[test]
fn reasoning_summaries_override_false_does_not_disable_support() {
    let mut model = model_info_from_slug("unknown-model");
    model.supports_reasoning_summaries = true;
    let config = ModelsManagerConfig {
        model_supports_reasoning_summaries: Some(false),
        ..Default::default()
    };

    let updated = with_config_overrides(model.clone(), &config);

    assert_eq!(updated, model);
}

#[test]
fn reasoning_summaries_override_false_is_noop_when_model_is_false() {
    let model = model_info_from_slug("unknown-model");
    let config = ModelsManagerConfig {
        model_supports_reasoning_summaries: Some(false),
        ..Default::default()
    };

    let updated = with_config_overrides(model.clone(), &config);

    assert_eq!(updated, model);
}

#[test]
fn model_context_window_override_clamps_to_max_context_window() {
    let mut model = model_info_from_slug("unknown-model");
    model.context_window = Some(273_000);
    model.max_context_window = Some(400_000);
    let config = ModelsManagerConfig {
        model_context_window: Some(500_000),
        ..Default::default()
    };

    let updated = with_config_overrides(model.clone(), &config);
    let mut expected = model;
    expected.context_window = Some(400_000);

    assert_eq!(updated, expected);
}

#[test]
fn model_context_window_uses_model_value_without_override() {
    let mut model = model_info_from_slug("unknown-model");
    model.context_window = Some(273_000);
    model.max_context_window = Some(400_000);
    let config = ModelsManagerConfig::default();

    let updated = with_config_overrides(model.clone(), &config);

    assert_eq!(updated, model);
}

#[test]
fn apply_beavoguix_branding_updates_remote_identity_text() {
    let mut model = model_info_from_slug("beavoguix");
    model.base_instructions = concat!(
        "You are Codex, a coding agent based on ",
        "G",
        "PT",
        "-5. You are running in the Codex CLI."
    )
    .to_string();
    model.model_messages = Some(ModelMessages {
        instructions_template: Some(
            concat!(
                "You are Codex, a coding agent based on ",
                "G",
                "PT",
                "-5.\n\n{{ personality }}"
            )
            .to_string(),
        ),
        instructions_variables: None,
    });
    model.availability_nux = Some(ModelAvailabilityNux {
        message: concat!("G", "PT", "-5.5 is now available in Codex.").to_string(),
    });

    let branded = apply_beavoguix_branding(model);

    assert_eq!(
        branded.base_instructions,
        "You are Beavoguix, a coding agent conceived and designed by Barre BEAVOGUI. You are running in the Beavoguix CLI."
    );
    assert_eq!(
        branded
            .model_messages
            .and_then(|messages| messages.instructions_template),
        Some(
            "You are Beavoguix, a coding agent conceived and designed by Barre BEAVOGUI.\n\n{{ personality }}".to_string()
        )
    );
    assert_eq!(
        branded.availability_nux.map(|nux| nux.message),
        Some("Beavoguix is now available in Beavoguix.".to_string())
    );
}
