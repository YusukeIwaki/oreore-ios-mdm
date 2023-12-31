require 'spec_helper'

describe 'POST /ddm/device_groups', logged_in: true do
  before {
    Ddm::DeviceGroup.delete_all
    Ddm::DeviceGroupItem.delete_all
  }

  it 'should create a new device group' do
    post '/ddm/device_groups', { name: 'group1', serial_numbers: "serial1\nserial2" }
    group = Ddm::DeviceGroup.find_by!(name: 'group1')
    expect(group.items.pluck(:device_identifier)).to eq(%w[serial1 serial2])
  end

  it 'should raise error if name is not given' do
    expect {
      post '/ddm/device_groups', { name: '', serial_numbers: "serial1\nserial2" }
    }.to raise_error
    expect(Ddm::DeviceGroup.count).to eq(0)
    expect(Ddm::DeviceGroupItem.count).to eq(0)
  end

  it 'should accept empty serial numbers' do
    post '/ddm/device_groups', { name: 'group1', serial_numbers: '' }
    group = Ddm::DeviceGroup.find_by!(name: 'group1')
    expect(group.items.count).to eq(0)
  end
end

describe 'POST /ddm/device_groups/:id', logged_in: true do
  before {
    Ddm::DeviceGroup.delete_all
    Ddm::DeviceGroupItem.delete_all
  }

  it 'should update a device group' do
    group = Ddm::DeviceGroup.create!(name: 'group1')
    post "/ddm/device_groups/#{group.id}", { serial_numbers: "serial1\nserial2" }
    group.reload
    expect(group.items.pluck(:device_identifier)).to eq(%w[serial1 serial2])
  end

  it 'should keep a device group' do
    group = Ddm::DeviceGroup.create!(name: 'group1')
    group.items.create!(device_identifier: 'serial1')
    group.items.create!(device_identifier: 'serial2')
    original_item_ids = Ddm::DeviceGroupItem.pluck(:id)
    post "/ddm/device_groups/#{group.id}", { serial_numbers: "serial2\nserial1" }
    expect(Ddm::DeviceGroupItem.where(device_group: group).pluck(:id)).to match_array(original_item_ids)
  end

  it 'should add and delete device group' do
    group = Ddm::DeviceGroup.create!(name: 'group1')
    group.items.create!(device_identifier: 'serial1')
    group.items.create!(device_identifier: 'serial2')
    post "/ddm/device_groups/#{group.id}", { serial_numbers: "serial2\nserial3" }
    expect(Ddm::DeviceGroupItem.where(device_group: group).pluck(:device_identifier)).to match_array(%w[serial2 serial3])
  end

  it 'should just add device group' do
    group = Ddm::DeviceGroup.create!(name: 'group1')
    group.items.create!(device_identifier: 'serial1')
    group.items.create!(device_identifier: 'serial2')
    original_item_ids = Ddm::DeviceGroupItem.pluck(:id)
    post "/ddm/device_groups/#{group.id}", { serial_numbers: "serial1\nserial2\nserial3" }
    expect(Ddm::DeviceGroupItem.where(device_group: group).pluck(:device_identifier)).to match_array(%w[serial1 serial2 serial3])
    expect(Ddm::DeviceGroupItem.where(device_group: group).pluck(:id)).to include(*original_item_ids)
  end

  it 'should delete all device group items' do
    group = Ddm::DeviceGroup.create!(name: 'group1')
    group.items.create!(device_identifier: 'serial1')
    group.items.create!(device_identifier: 'serial2')
    post "/ddm/device_groups/#{group.id}", { serial_numbers: "" }
    expect(Ddm::DeviceGroupItem.where(device_group: group).count).to eq(0)
  end
end
