import {
  ArrayNotEmpty,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AnswerOption, QuestionAnswerFormat, ShortAnswerType } from '../question.types';

export class CreateQuestionDto {
  @IsUUID()
  subTestId!: string;

  @IsString()
  promptText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  materialTopic?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsUrl({}, { each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsBoolean()
  isMathContent?: boolean;

  @IsEnum(QuestionAnswerFormat)
  answerFormat!: QuestionAnswerFormat;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE)
  @IsString()
  @MaxLength(1000)
  optionA?: string;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE)
  @IsString()
  @MaxLength(1000)
  optionB?: string;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE)
  @IsString()
  @MaxLength(1000)
  optionC?: string;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE)
  @IsString()
  @MaxLength(1000)
  optionD?: string;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE)
  @IsString()
  @MaxLength(1000)
  optionE?: string;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE)
  @IsEnum(AnswerOption)
  correctAnswer?: AnswerOption;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  complexStatements?: string[];

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX)
  @IsString()
  complexOptionLeftLabel?: string;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX)
  @IsString()
  complexOptionRightLabel?: string;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(4)
  @IsIn(['LEFT', 'RIGHT'], { each: true })
  complexCorrectAnswers?: ('LEFT' | 'RIGHT')[];

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.SHORT_INPUT)
  @IsEnum(ShortAnswerType)
  shortAnswerType?: ShortAnswerType;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.SHORT_INPUT)
  @IsString()
  shortAnswerKey?: string;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.SHORT_INPUT)
  @IsOptional()
  @IsNumber()
  shortAnswerTolerance?: number;

  @ValidateIf((o: CreateQuestionDto) => o.answerFormat === QuestionAnswerFormat.SHORT_INPUT)
  @IsOptional()
  @IsBoolean()
  shortAnswerCaseSensitive?: boolean;

  @IsString()
  discussion!: string;
}
