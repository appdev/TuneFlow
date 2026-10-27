<template>
  <div>
    <ConnectionSetup v-if="required && !status.connected" />
    <fieldset v-if="loaded" :class="$style.content" :disabled="blocked" :inert="blocked || undefined" :aria-disabled="blocked">
      <slot />
    </fieldset>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ConnectionSetup from './ConnectionSetup.vue'
import { useServiceStatus } from './useSession'
const props = withDefaults(defineProps<{ required?: boolean }>(), { required: true })
const status = useServiceStatus()
const loaded = ref(!props.required || status.value.connected)
const blocked = computed(() => props.required && !status.value.connected)
watch(blocked, value => { if (!value) loaded.value = true })
</script>
<style module lang="less">
.content { border: 0; margin: 0; padding: 0; min-width: 0; &:disabled { opacity: .55; } }
</style>
