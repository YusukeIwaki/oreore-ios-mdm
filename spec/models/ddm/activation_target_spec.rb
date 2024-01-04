require 'spec_helper'

RSpec.describe Ddm::ActivationTarget do
  describe '#display_sorted' do
    before {
      Ddm::DeviceGroupItem.delete_all
      Ddm::DeviceGroup.delete_all
      Ddm::ActivationTarget.delete_all
      Ddm::Activation.delete_all
    }

    it 'should list targets for group' do
      group = Ddm::DeviceGroup.create!(name: 'group1')
      group.items.create!(device_identifier: 'SERIALNUMBER1')

      activation = Ddm::Activation.create!(
        name: 'apply_test1',
        type: 'com.apple.activation.simple',
        payload: { 'StandardConfigurations' => ['@configuration/test1'] },
      )
      target = activation.targets.create!(target_identifier: 'group1')

      expect(Ddm::ActivationTarget.display_sorted.map(&:id)).to eq([target.id])
    end

    it 'should list ungrouped target' do
      activation = Ddm::Activation.create!(
        name: 'apply_test1',
        type: 'com.apple.activation.simple',
        payload: { 'StandardConfigurations' => ['@configuration/test1'] },
      )
      target = activation.targets.create!(target_identifier: 'SERIAL1')

      expect(Ddm::ActivationTarget.display_sorted.map(&:id)).to eq([target.id])
    end
  end
end
