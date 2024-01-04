class Ddm::ActivationForm
  include ActiveModel::Model
  include ActiveModel::Attributes

  attribute :name, :string
  attribute :type, :string
  attribute :payload, :string
  attribute :target_identifiers, :string

  def self.new_with_sliced(params)
    new(params.slice(*attribute_names.map(&:to_sym)))
  end

  def create
    payload_object = YAML.load(payload)
    target_identifier_array = reject_blank(target_identifiers)
    ActiveRecord::Base.transaction do
      activation = Ddm::Activation.create!(
        name: name,
        type: "com.apple.activation.simple",
        payload: payload_object,
      )
      if target_identifier_array.empty?
        Ddm::ActivationTarget.create!(activation: activation)
      else
        Ddm::ActivationTarget.insert_all(new_targets_for(activation, target_identifier_array))
      end
    end
  end

  def update(ddm_activation_id)
    payload_object = YAML.load(payload)
    activation = Ddm::Activation.find(ddm_activation_id)
    self.name = activation.name
    existing_target_identifiers = activation.targets.pluck(:target_identifier)
    target_identifier_array = reject_blank(target_identifiers)
    ActiveRecord::Base.transaction do
      activation.update!(
        name: name,
        type: "com.apple.activation.simple",
        payload: payload_object,
      )
      if target_identifier_array.empty?
        if existing_target_identifiers.empty?
          Ddm::ActivationTarget.create!(activation: activation)
        elsif existing_target_identifiers.all?(&:nil?)
          # do nothing
        else
          Ddm::ActivationTarget.where(activation: activation).delete_all
          Ddm::ActivationTarget.create!(activation: activation)
        end
      else
        if existing_target_identifiers.empty?
          Ddm::ActivationTarget.insert_all(new_targets_for(activation, target_identifier_array))
        elsif existing_target_identifiers.all?(:nil?)
          Ddm::ActivationTarget.where(activation: activation).delete_all
          Ddm::ActivationTarget.insert_all(new_targets_for(activation, target_identifier_array))
        else
          (existing_target_identifiers - target_identifier_array).presence.try! do |removed|
            Ddm::ActivationTarget.where(activation: activation, target_identifier: removed).delete_all
          end
          (target_identifier_array - existing_target_identifiers).presence.try! do |added|
            Ddm::ActivationTarget.insert_all(new_targets_for(activation, added))
          end
        end
      end
    end
  end

  private def reject_blank(lines_str)
    lines_str.split("\n").filter_map { |x| x.strip.presence }.uniq
  end

  private def new_targets_for(activation, target_identifier_array)
    timestamp = Time.now
    target_identifier_array.map do |target_identifier|
      {
        ddm_activation_id: activation.id,
        target_identifier: target_identifier,
        created_at: timestamp,
      }
    end
  end
end
